import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AuditSeverity {
  INFO = 'INFO',
  WARN = 'WARN',
  SECURITY = 'SECURITY',
  CRITICAL = 'CRITICAL',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Acción auditada (ej: ORDER_CREATED, PAYMENT_PROCESSED, WAF_BLOCKED, BOT_DETECTED, RATE_LIMITED)
  @Column({ type: 'varchar', length: 100 })
  @Index()
  action: string;

  @Column({
    type: 'enum',
    enum: AuditSeverity,
    default: AuditSeverity.INFO,
  })
  @Index()
  severity: AuditSeverity;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  ipAddress?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpoint?: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  method?: string | null;

  @Column({ type: 'int', nullable: true })
  statusCode?: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  checkoutSessionId?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  orderNumber?: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  // Metadata contextual serializada (datos sensibles como números de tarjeta o CVC siempre censurados)
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  @Index()
  createdAt: Date;
}
