import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditLogService } from './services/audit-log.service';
import { IpReputationService } from './services/ip-reputation.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { IdempotencyService } from './services/idempotency.service';
import { RateLimiterGuard } from './guards/rate-limiter.guard';
import { AntiBotGuard } from './guards/anti-bot.guard';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor';
import { WafMiddleware } from './middleware/waf.middleware';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [
    AuditLogService,
    IpReputationService,
    RateLimiterService,
    IdempotencyService,
    RateLimiterGuard,
    AntiBotGuard,
    IdempotencyInterceptor,
    WafMiddleware,
  ],
  exports: [
    AuditLogService,
    IpReputationService,
    RateLimiterService,
    IdempotencyService,
    RateLimiterGuard,
    AntiBotGuard,
    IdempotencyInterceptor,
    WafMiddleware,
  ],
})
export class SecurityModule {}
