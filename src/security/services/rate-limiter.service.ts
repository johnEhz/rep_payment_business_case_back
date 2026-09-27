import { Injectable, Logger } from '@nestjs/common';
import { IpReputationService } from './ip-reputation.service';

export enum RateLimitTier {
  DEFAULT = 'DEFAULT',
  CHECKOUT_PREVIEW = 'CHECKOUT_PREVIEW',
  CHECKOUT_ORDER = 'CHECKOUT_ORDER',
  CHECKOUT_PAY = 'CHECKOUT_PAY',
}

export interface TierConfig {
  maxRequests: number;
  windowMs: number;
}

export const RATE_LIMIT_CONFIGS: Record<RateLimitTier, TierConfig> = {
  [RateLimitTier.DEFAULT]: { maxRequests: 120, windowMs: 60 * 1000 },
  [RateLimitTier.CHECKOUT_PREVIEW]: { maxRequests: 40, windowMs: 60 * 1000 },
  [RateLimitTier.CHECKOUT_ORDER]: { maxRequests: 8, windowMs: 60 * 1000 },
  [RateLimitTier.CHECKOUT_PAY]: { maxRequests: 4, windowMs: 60 * 1000 },
};

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  // Almacenamiento deslizante en memoria: key -> timestamps[]
  private readonly hitMap = new Map<string, number[]>();

  constructor(private readonly ipReputationService: IpReputationService) {
    // Tarea periódica de limpieza cada 5 minutos
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Evalúa y registra el consumo de cuota para una clave (IP o IP:Session)
   */
  checkRateLimit(
    identifier: string,
    tier: RateLimitTier = RateLimitTier.DEFAULT,
  ): {
    allowed: boolean;
    limit: number;
    current: number;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const config = RATE_LIMIT_CONFIGS[tier];
    const key = `${tier}:${identifier}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const existingHits = this.hitMap.get(key) || [];
    const recentHits = existingHits.filter((t) => t > windowStart);

    if (recentHits.length >= config.maxRequests) {
      // Excedió el límite
      const oldestHit = recentHits[0] || windowStart;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestHit + config.windowMs - now) / 1000));

      // Si el exceso es severo (más del doble del límite en pagos u órdenes), penalizar IP
      if (
        (tier === RateLimitTier.CHECKOUT_PAY || tier === RateLimitTier.CHECKOUT_ORDER) &&
        recentHits.length >= config.maxRequests * 2
      ) {
        this.ipReputationService.recordViolation(
          identifier,
          `Severe rate limit flooding on sensitive endpoint (${tier})`,
          2,
        );
      }

      return {
        allowed: false,
        limit: config.maxRequests,
        current: recentHits.length,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    recentHits.push(now);
    this.hitMap.set(key, recentHits);

    return {
      allowed: true,
      limit: config.maxRequests,
      current: recentHits.length,
      remaining: config.maxRequests - recentHits.length,
      retryAfterSeconds: 0,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const maxWindow = 60 * 1000;
    for (const [key, hits] of this.hitMap.entries()) {
      const valid = hits.filter((t) => now - t < maxWindow);
      if (valid.length === 0) {
        this.hitMap.delete(key);
      } else {
        this.hitMap.set(key, valid);
      }
    }
  }
}
