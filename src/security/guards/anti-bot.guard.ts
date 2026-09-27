import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { IpReputationService } from '../services/ip-reputation.service';
import { AuditLogService } from '../services/audit-log.service';
import { AuditSeverity } from '../entities/audit-log.entity';

@Injectable()
export class AntiBotGuard implements CanActivate {
  private readonly logger = new Logger(AntiBotGuard.name);

  // User-Agents sospechosos comunes en ataques automatizados
  private readonly SUSPICIOUS_USER_AGENTS = [
    /python-requests/i,
    /aiohttp/i,
    /libwww-perl/i,
    /httpclient/i,
    /scrapy/i,
    /headlesschrome/i,
    /phantomjs/i,
    /selenium/i,
    /puppeteer/i,
    /mechanize/i,
    /go-http-client/i,
    /curl\/\d/i,
  ];

  constructor(
    private readonly ipReputationService: IpReputationService,
    private readonly auditLogService: AuditLogService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = this.ipReputationService.getClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) || '';

    // 1. Detección de Trampa Honeypot en el Body
    if (req.body && typeof req.body === 'object') {
      const honeypotFields = ['_hp_check', 'website', 'fax', '_honey_token'];
      for (const field of honeypotFields) {
        if (req.body[field]) {
          this.logger.warn(`🤖 BOT TRAPPED: Honeypot field "${field}" filled by IP ${ip}`);

          this.ipReputationService.recordViolation(ip, `Bot trap: honeypot field "${field}" triggered`, 4);

          this.auditLogService.logEvent({
            action: 'BOT_TRAPPED_HONEYPOT',
            severity: AuditSeverity.SECURITY,
            ipAddress: ip,
            userAgent,
            endpoint: req.originalUrl,
            method: req.method,
            statusCode: HttpStatus.FORBIDDEN,
            metadata: { field, value: req.body[field] },
          });

          throw new HttpException(
            {
              statusCode: HttpStatus.FORBIDDEN,
              error: 'Forbidden',
              message: 'Automated submission detected and rejected.',
            },
            HttpStatus.FORBIDDEN,
          );
        }
      }
    }

    // 2. Verificación de User-Agent sospechoso / Scrapers no autorizados
    for (const pattern of this.SUSPICIOUS_USER_AGENTS) {
      if (pattern.test(userAgent)) {
        this.logger.warn(`🤖 BOT DETECTED: Suspicious User-Agent "${userAgent}" from IP ${ip}`);

        this.ipReputationService.recordViolation(ip, `Automated bot agent: ${userAgent.slice(0, 50)}`, 2);

        this.auditLogService.logEvent({
          action: 'BOT_DETECTED_USER_AGENT',
          severity: AuditSeverity.WARN,
          ipAddress: ip,
          userAgent,
          endpoint: req.originalUrl,
          method: req.method,
          statusCode: HttpStatus.FORBIDDEN,
          metadata: { userAgent },
        });

        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            error: 'Forbidden',
            message: 'Direct automated requests from automated scripts are prohibited.',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 3. Verificación de cabeceras mínimas esperadas en navegadores humanos
    if (!userAgent || userAgent.trim().length < 5) {
      this.logger.warn(`🤖 BOT DETECTED: Empty or invalid User-Agent from IP ${ip}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Client User-Agent header is missing or malformed.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return true;
  }
}
