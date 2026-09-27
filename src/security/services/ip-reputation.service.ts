import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';

export interface IpBlockInfo {
  ip: string;
  reason: string;
  blockedAt: Date;
  expiresAt: Date;
  violationCount: number;
}

@Injectable()
export class IpReputationService {
  private readonly logger = new Logger(IpReputationService.name);

  // Mapa de IPs bloqueadas activamente
  private readonly blockedIps = new Map<string, IpBlockInfo>();

  // Mapa de violaciones recientes por IP: ip -> timestamps[]
  private readonly violations = new Map<string, number[]>();

  // Configuración de tolerancia
  private readonly VIOLATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutos
  private readonly VIOLATION_THRESHOLD = 5; // 5 faltas provocan bloqueo
  private readonly DEFAULT_BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutos de bloqueo

  // IPs excluidas de bloqueos automáticos
  private readonly whitelistedIps = new Set<string>(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

  /**
   * Extrae la dirección IP real del cliente evitando spoofing de IPs en lista blanca
   */
  getClientIp(req: Request): string {
    const socketIp = req.socket?.remoteAddress || '';
    const isLocalSocket = socketIp.includes('127.0.0.1') || socketIp === '::1';
    const trustProxy = process.env.TRUST_PROXY === 'true';

    // Solo confiar en cabeceras de proxy si viene configurado o desde socket local
    if (trustProxy || isLocalSocket) {
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) {
        const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        const firstIp = forwardedStr.split(',')[0].trim();
        // Evitar que un atacante remoto falsee ser 127.0.0.1
        if (firstIp && !(firstIp.includes('127.0.0.1') && !isLocalSocket)) {
          return firstIp;
        }
      }

      const cfIp = req.headers['cf-connecting-ip'];
      if (cfIp) {
        return Array.isArray(cfIp) ? cfIp[0].trim() : cfIp.trim();
      }

      const realIp = req.headers['x-real-ip'];
      if (realIp) {
        return Array.isArray(realIp) ? realIp[0].trim() : realIp.trim();
      }
    }

    return req.ip || socketIp || '127.0.0.1';
  }

  /**
   * Verifica si una IP está actualmente bloqueada
   */
  isIpBlocked(ip: string): { blocked: boolean; remainingSeconds?: number; reason?: string } {
    if (this.whitelistedIps.has(ip)) {
      return { blocked: false };
    }

    const block = this.blockedIps.get(ip);
    if (!block) {
      return { blocked: false };
    }

    const now = Date.now();
    if (now >= block.expiresAt.getTime()) {
      // El bloqueo ha expirado, limpiar
      this.blockedIps.delete(ip);
      this.violations.delete(ip);
      this.logger.log(`IP ${ip} block expired. Restored access.`);
      return { blocked: false };
    }

    const remainingSeconds = Math.ceil((block.expiresAt.getTime() - now) / 1000);
    return {
      blocked: true,
      remainingSeconds,
      reason: block.reason,
    };
  }

  /**
   * Registra una falta de seguridad (WAF, Bot, Rate limit, Honeypot)
   */
  recordViolation(ip: string, reason: string, weight = 1): void {
    if (this.whitelistedIps.has(ip)) {
      return;
    }

    const now = Date.now();
    const timestamps = (this.violations.get(ip) || []).filter(
      (t) => now - t < this.VIOLATION_WINDOW_MS,
    );

    for (let i = 0; i < weight; i++) {
      timestamps.push(now);
    }
    this.violations.set(ip, timestamps);

    this.logger.warn(`Security violation recorded for IP ${ip}: "${reason}" (Total: ${timestamps.length}/${this.VIOLATION_THRESHOLD})`);

    if (timestamps.length >= this.VIOLATION_THRESHOLD) {
      this.blockIp(ip, this.DEFAULT_BLOCK_DURATION_MS, `Exceeded security violation threshold (${timestamps.length} events): ${reason}`);
    }
  }

  /**
   * Bloquea manualmente o automáticamente una IP por una duración determinada
   */
  blockIp(ip: string, durationMs = this.DEFAULT_BLOCK_DURATION_MS, reason = 'Automated security block'): void {
    if (this.whitelistedIps.has(ip)) {
      this.logger.warn(`Attempted to block whitelisted IP ${ip}. Ignored.`);
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMs);

    this.blockedIps.set(ip, {
      ip,
      reason,
      blockedAt: now,
      expiresAt,
      violationCount: (this.violations.get(ip) || []).length,
    });

    this.logger.error(`🚨 IP ${ip} HAS BEEN TEMPORARILY BLOCKED until ${expiresAt.toISOString()}. Reason: ${reason}`);
  }

  /**
   * Desbloquea una IP
   */
  unblockIp(ip: string): boolean {
    const deleted = this.blockedIps.delete(ip);
    this.violations.delete(ip);
    if (deleted) {
      this.logger.log(`IP ${ip} was manually unblocked.`);
    }
    return deleted;
  }

  /**
   * Lista las IPs bloqueadas actualmente
   */
  getBlockedIps(): IpBlockInfo[] {
    const now = Date.now();
    // Limpieza oportunista de expiradas
    for (const [ip, block] of this.blockedIps.entries()) {
      if (now >= block.expiresAt.getTime()) {
        this.blockedIps.delete(ip);
        this.violations.delete(ip);
      }
    }
    return Array.from(this.blockedIps.values());
  }
}
