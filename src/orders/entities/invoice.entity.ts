import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Order, bigintTransformer } from './order.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Número consecutivo o prefijo oficial de factura (ej: INV-JHM-62408)
  @Column({ type: 'varchar', length: 60, unique: true })
  @Index()
  invoiceNumber: string;

  @Column({ type: 'uuid' })
  @Index()
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  transactionId?: string | null;

  @ManyToOne(() => Transaction, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'transactionId' })
  transaction?: Transaction | null;

  @Column({ type: 'varchar', length: 150 })
  customerName: string;

  @Column({ type: 'varchar', length: 150 })
  customerEmail: string;

  @Column({ type: 'varchar', length: 30 })
  customerPhone: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  subtotalAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  feeAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  deliveryFeeAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  discountAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  taxAmount: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  totalAmount: number;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  @Column({ type: 'timestamp with time zone' })
  issuedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
