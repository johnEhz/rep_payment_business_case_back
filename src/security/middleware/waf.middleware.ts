import { Injectable, NestMiddleware, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { IpReputationService } from '../services/ip-reputation.service';
import { AuditLogService } from '../services/audit-log.service';
import { AuditSeverity } from '../entities/audit-log.entity';

@Injectable()
export class WafMiddleware implements NestMiddleware {
  private readonly logger = new Logger(WafMiddleware.name);

  // Patrones heurísticos de vectores de ataque comunes
  private readonly ATTACK_PATTERNS = [
    // SQL Injection
    {
      name: 'SQL_INJECTION',
      regex: new RegExp(
        '(\\b(union(\\s+all)?\\s+select|select\\s+.*\\s+from|insert\\s+into|delete\\s+from|drop\\s+(table|database)|exec(\\s|\\+)+(s|x)p|benchmark\\s*\\(|pg_sleep\\s*\\()|\\b(or|and)\\b\\s+[\'"]?\\d+[\'"]?\\s*=\\s*[\'"]?\\d+|;\\s*--)',
        'i',
      ),
    },
    // Cross-Site Scripting (XSS)
    {
      name: 'XSS_ATTACK',
      regex: new RegExp(
        '(<script\\b[^>]*>|javascript:\\s*|onerror\\s*=|onload\\s*=|onclick\\s*=|eval\\s*\\(|<iframe\\b|<object\\b|<embed\\b)',
        'i',
      ),
    },
    // Path Traversal
    {
      name: 'PATH_TRAVERSAL',
      regex: new RegExp('(\\.\\.\\/|\\.\\.\\\\|\\/etc\\/passwd|\\/etc\\/shadow|c:\\\\windows\\\\system32|boot\\.ini)', 'i'),
    },
    // Remote Command Execution / Shell Injection
    {
      name: 'COMMAND_INJECTION',
      regex: new RegExp('(\\b(cmd\\.exe|powershell(\\.exe)?|\\/bin\\/sh|\\/bin\\/bash)\\b|;\\s*(rm|del|curl|wget)\\s+)', 'i'),
    },
    // Prototype Pollution
    {
      name: 'PROTOTYPE_POLLUTION',
      regex: new RegExp('(__proto__|constructor\\.prototype)', 'i'),
    },
  ];

  constructor(
    private readonly ipReputationService: IpReputationService,
    private readonly auditLogService: AuditLogService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Bypass inmediato para health checks del AWS Application Load Balancer
    if (req.path === '/api/health' || req.path === '/health' || req.path === '/' || req.originalUrl.startsWith('/api/health')) {
      return next();
    }

    const ip = this.ipReputationService.getClientIp(req);

    // 1. Verificación previa de IP Bloqueada
    const ipStatus = this.ipReputationService.isIpBlocked(ip);
    if (ipStatus.blocked) {
      res.status(HttpStatus.FORBIDDEN).json({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        message: `Access denied. Your IP is temporarily suspended. Try again in ${ipStatus.remainingSeconds}s.`,
      });
      return;
    }

    // 2. Ofuscación de cabeceras del servidor y endurecimiento HTTP (WAF Headers)
    res.removeHeader('X-Powered-By');
    res.setHeader('Server', 'SecureGateway/2.0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(self)',
    );

    // 3. Inspección profunda de Payloads (URL, Query, Body)
    const inspectionTarget = this.buildInspectionString(req);

    for (const pattern of this.ATTACK_PATTERNS) {
      if (pattern.regex.test(inspectionTarget)) {
        this.logger.warn(`🚨 WAF BLOCKED [${pattern.name}] from IP: ${ip} on ${req.method} ${req.originalUrl}`);

        // Penalizar fuertemente la IP
        this.ipReputationService.recordViolation(ip, `WAF trigger: ${pattern.name}`, 3);

        // Registrar en Auditoría Central
        this.auditLogService.logEvent({
          action: `WAF_BLOCKED_${pattern.name}`,
          severity: AuditSeverity.SECURITY,
          ipAddress: ip,
          userAgent: req.headers['user-agent'] as string,
          endpoint: req.originalUrl,
          method: req.method,
          statusCode: HttpStatus.FORBIDDEN,
          metadata: {
            attackType: pattern.name,
            matchedSnippet: inspectionTarget.slice(0, 300),
          },
        });

        res.status(HttpStatus.FORBIDDEN).json({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          message: 'Request blocked by Web Application Firewall (WAF) security policies.',
        });
        return;
      }
    }

    next();
  }

  private buildInspectionString(req: Request): string {
    const parts: string[] = [];

    if (req.originalUrl) {
      try {
        parts.push(decodeURIComponent(req.originalUrl));
      } catch {
        parts.push(req.originalUrl);
      }
    }

    if (req.query && Object.keys(req.query).length > 0) {
      parts.push(JSON.stringify(req.query));
    }

    if (req.body && Object.keys(req.body).length > 0) {
      parts.push(JSON.stringify(req.body));
    }

    return parts.join(' ');
  }
}
