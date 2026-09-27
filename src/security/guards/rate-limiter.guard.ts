import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimiterService, RateLimitTier } from '../services/rate-limiter.service';
import { IpReputationService } from '../services/ip-reputation.service';
import { AuditLogService } from '../services/audit-log.service';
import { AuditSeverity } from '../entities/audit-log.entity';

export const RATE_LIMIT_KEY = 'RATE_LIMIT_TIER';
export const RateLimit = (tier: RateLimitTier) => SetMetadata(RATE_LIMIT_KEY, tier);

@Injectable()
export class RateLimiterGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiterService: RateLimiterService,
    private readonly ipReputationService: IpReputationService,
    private readonly auditLogService: AuditLogService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const ip = this.ipReputationService.getClientIp(request);

    // 1. Verificación previa de IP Bloqueada / Reputación
    const ipStatus = this.ipReputationService.isIpBlocked(ip);
    if (ipStatus.blocked) {
      this.auditLogService.logEvent({
        action: 'IP_BLOCKED_REQUEST_ATTEMPT',
        severity: AuditSeverity.SECURITY,
        ipAddress: ip,
        userAgent: request.headers['user-agent'],
        endpoint: request.originalUrl || request.url,
        method: request.method,
        statusCode: HttpStatus.FORBIDDEN,
        metadata: { reason: ipStatus.reason, remainingSeconds: ipStatus.remainingSeconds },
      });

      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: `Your IP address has been temporarily restricted due to suspicious activity. Try again in ${ipStatus.remainingSeconds} seconds.`,
          remainingSeconds: ipStatus.remainingSeconds,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // 2. Determinar el nivel de Rate Limiting (por defecto o decorado)
    const tier =
      this.reflector.getAllAndOverride<RateLimitTier>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || RateLimitTier.DEFAULT;

    // Usar sesión de checkout en conjunto con la IP si existe para evitar rotación de IP
    const sessionId = (request.headers['x-checkout-session-id'] as string) || '';
    const rateLimitIdentifier = sessionId ? `${ip}:${sessionId}` : ip;

    const rateResult = this.rateLimiterService.checkRateLimit(rateLimitIdentifier, tier);

    // Inyectar cabeceras estándar de rate limit en la respuesta
    response.setHeader('X-RateLimit-Limit', rateResult.limit);
    response.setHeader('X-RateLimit-Remaining', rateResult.remaining);

    if (!rateResult.allowed) {
      response.setHeader('Retry-After', rateResult.retryAfterSeconds);

      this.auditLogService.logEvent({
        action: 'RATE_LIMIT_EXCEEDED',
        severity: AuditSeverity.WARN,
        ipAddress: ip,
        userAgent: request.headers['user-agent'],
        endpoint: request.originalUrl || request.url,
        method: request.method,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        metadata: {
          tier,
          limit: rateResult.limit,
          current: rateResult.current,
          retryAfterSeconds: rateResult.retryAfterSeconds,
        },
      });

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Too many requests on this endpoint. Please slow down and try again in ${rateResult.retryAfterSeconds} seconds.`,
          retryAfter: rateResult.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
