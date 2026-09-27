import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { IdempotencyService } from '../services/idempotency.service';
import { AuditLogService } from '../services/audit-log.service';
import { AuditSeverity } from '../entities/audit-log.entity';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly idempotencyService: IdempotencyService,
    private readonly auditLogService: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // Solo aplicar idempotencia a métodos mutantes (POST, PUT, PATCH)
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      return next.handle();
    }

    // Obtener la clave de idempotencia enviada EXCLUSIVAMENTE en cabeceras HTTP
    const headerKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string;

    // Si no se envió cabecera, generar una clave basada en sesión + endpoint como fallback
    const sessionId = (req.headers['x-checkout-session-id'] as string) || '';
    const idempotencyKey = headerKey || (sessionId ? `${sessionId}:${req.path}` : null);

    if (!idempotencyKey) {
      return next.handle();
    }

    const payloadHash = this.idempotencyService.hashPayload({
      body: req.body,
      path: req.path,
    });

    const lock = this.idempotencyService.acquireLock(idempotencyKey, payloadHash);

    if (lock.status === 'PAYLOAD_MISMATCH') {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          message: 'The Idempotency-Key has already been used with a different request payload.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (lock.status === 'IN_PROGRESS') {
      this.logger.warn(`Concurrent request detected for idempotency key ${idempotencyKey}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'A request with this idempotency key is already in progress. Please do not double-submit.',
        },
        HttpStatus.CONFLICT,
      );
    }

    if (lock.status === 'REPLAY' && lock.record) {
      this.logger.log(`Idempotency HIT for key ${idempotencyKey}. Replaying cached response.`);
      res.setHeader('X-Idempotency-Lookup', 'HIT');
      if (lock.record.statusCode) {
        res.status(lock.record.statusCode);
      }

      this.auditLogService.logEvent({
        action: 'IDEMPOTENT_REPLAY',
        severity: AuditSeverity.INFO,
        endpoint: req.originalUrl,
        method: req.method,
        statusCode: lock.record.statusCode || 200,
        metadata: { idempotencyKey },
      });

      return of(lock.record.responseBody);
    }

    res.setHeader('X-Idempotency-Lookup', 'MISS');

    return next.handle().pipe(
      tap({
        next: (body) => {
          // Si la respuesta es de un pago declinado que permite reintentar,
          // liberar la clave de idempotencia para que el usuario pueda intentar nuevamente
          if (body && typeof body === 'object' && body.canRetry === true && body.success === false) {
            this.idempotencyService.release(idempotencyKey);
          } else {
            this.idempotencyService.complete(idempotencyKey, res.statusCode || 200, body);
          }
        },
        error: (err) => {
          // Si falló por validación o error de negocio, liberar para permitir corrección
          this.idempotencyService.release(idempotencyKey);
        },
      }),
    );
  }
}
