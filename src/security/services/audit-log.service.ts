import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditSeverity } from '../entities/audit-log.entity';

export interface CreateAuditLogParams {
  action: string;
  severity?: AuditSeverity;
  ipAddress?: string | null;
  userAgent?: string | null;
  endpoint?: string | null;
  method?: string | null;
  statusCode?: number | null;
  checkoutSessionId?: string | null;
  orderNumber?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, any> | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Registra un evento de auditoría de forma asíncrona y segura.
   * Censura automáticamente cualquier dato financiero sensible (tarjetas, CVC, tokens).
   */
  async logEvent(params: CreateAuditLogParams): Promise<void> {
    try {
      const sanitizedMeta = this.sanitizeMetadata(params.metadata);

      const log = this.auditLogRepository.create({
        action: params.action,
        severity: params.severity || AuditSeverity.INFO,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent ? params.userAgent.substring(0, 255) : null,
        endpoint: params.endpoint ? params.endpoint.substring(0, 255) : null,
        method: params.method ? params.method.substring(0, 10) : null,
        statusCode: params.statusCode || null,
        checkoutSessionId: params.checkoutSessionId || null,
        orderNumber: params.orderNumber || null,
        durationMs: params.durationMs || null,
        metadata: sanitizedMeta,
      });

      // Guardar en segundo plano para no demorar la respuesta HTTP
      this.auditLogRepository.save(log).catch((err) => {
        this.logger.error(`Error saving audit log [${params.action}]: ${err.message}`);
      });

      // Emisión de log estructurado en consola
      const message = `[AUDIT ${params.severity || 'INFO'}] ${params.action} | IP: ${params.ipAddress || 'unknown'} | Endpoint: ${params.method || ''} ${params.endpoint || ''} | Code: ${params.statusCode || 'N/A'}`;
      if (params.severity === AuditSeverity.CRITICAL || params.severity === AuditSeverity.SECURITY) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    } catch (err: any) {
      this.logger.error(`Failed to dispatch audit log: ${err?.message || err}`);
    }
  }

  /**
   * Censura recursivamente datos sensibles (tarjetas, CVV, passwords)
   */
  private sanitizeMetadata(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeMetadata(item));
    }

    const sanitized: Record<string, any> = {};
    const sensitiveKeys = [
      'number',
      'cardnumber',
      'card_number',
      'cvc',
      'cvv',
      'password',
      'cardtoken',
      'card_token',
      'token',
      'accesstoken',
      'acceptancetoken',
      'secret',
    ];

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some((s) => lowerKey.includes(s));

      if (isSensitive && typeof value === 'string') {
        if (value.length > 4) {
          sanitized[key] = `••••••••${value.slice(-4)}`;
        } else {
          sanitized[key] = '••••';
        }
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Consulta registros de auditoría recientes
   */
  async getRecentLogs(limit = 100, severity?: AuditSeverity): Promise<AuditLog[]> {
    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .take(limit);

    if (severity) {
      qb.where('log.severity = :severity', { severity });
    }

    return qb.getMany();
  }
}
