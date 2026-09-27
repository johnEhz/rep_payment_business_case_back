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
import { Order } from '../../orders/entities/order.entity';

export enum TransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  VOIDED = 'VOIDED',
  ERROR = 'ERROR',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Relación única con la orden de compra
  @Column({ type: 'uuid' })
  @Index()
  orderId: string;

  @ManyToOne(() => Order, (order) => order.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  // Referencia única de la transacción (ej: JHM-11490-179045...)
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index()
  reference: string;

  // ID de la transacción retornado por la pasarela de pagos
  @Column({ type: 'varchar', length: 150, nullable: true })
  @Index()
  gatewayTransactionId?: string | null;

  // Monto total en centavos procesado en la pasarela
  @Column({ type: 'bigint' })
  amountInCents: number;

  get totalAmountInCents(): number {
    return Number(this.amountInCents);
  }

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  // Método de pago (CARD, PSE, NEQUI, etc.)
  @Column({ type: 'varchar', length: 50, default: 'CARD' })
  paymentMethod: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  @Index()
  status: TransactionStatus;

  // Mensaje de estado devuelto por el procesador
  @Column({ type: 'varchar', length: 255, nullable: true })
  statusMessage?: string | null;

  // Número de cuotas diferidas
  @Column({ type: 'int', default: 1 })
  installments: number;

  // Token de aceptación de términos de la pasarela específico para esta transacción
  @Column({ type: 'text', nullable: true })
  acceptanceToken?: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
