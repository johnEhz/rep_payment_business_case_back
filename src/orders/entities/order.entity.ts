import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { StockReservation } from '../../inventory/entities/stock-reservation.entity';
import { Delivery } from '../../delivery/entities/delivery.entity';
import { CheckoutSession } from './checkout-session.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

export enum OrderStatus {
  CREATED = 'CREATED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  PREPARING = 'PREPARING',
  READY_FOR_DELIVERY = 'READY_FOR_DELIVERY',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  REFUNDED = 'REFUNDED',
}

export const bigintTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | number | null | undefined): number | null | undefined =>
    value !== null && value !== undefined ? Number(value) : value,
};

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Código legible visible (ej: DYN-10452)
  @Column({ type: 'varchar', length: 50, unique: true })
  @Index()
  orderNumber: string;

  // Token criptográfico seguro para acceso de cliente invitado sin autenticación
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index()
  accessToken: string;

  // Sesión de checkout segura que identifica al comprador anónimo
  @Column({ type: 'uuid', nullable: true })
  @Index()
  checkoutSessionId?: string | null;

  @ManyToOne(() => CheckoutSession, (cs) => cs.orders, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checkoutSessionId' })
  checkoutSession?: CheckoutSession | null;

  // Nullable para permitir tanto Guest Checkout como usuarios registrados
  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  // Datos de contacto de la orden (invitado o registrado)
  @Column({ type: 'varchar', length: 150 })
  customerName: string;

  @Column({ type: 'varchar', length: 150 })
  customerEmail: string;

  @Column({ type: 'varchar', length: 30 })
  customerPhone: string;

  @Column({ type: 'varchar', length: 15, nullable: true })
  customerPhoneExtension?: string | null;

  // Datos de entrega
  @Column({ type: 'varchar', length: 255 })
  deliveryAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deliveryNeighborhood?: string | null;

  @Column({ type: 'varchar', length: 100, default: 'Medellín' })
  deliveryCity: string;

  @Column({ type: 'varchar', length: 100, default: 'Antioquia' })
  deliveryDepartment: string;

  @Column({ type: 'varchar', length: 100, default: 'Colombia' })
  deliveryCountry: string;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  deliveryLatitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  deliveryLongitude: number;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  // Valores monetarios en minor units (centavos de COP) con transformer numérico
  @Column({ type: 'bigint', transformer: bigintTransformer })
  subtotalAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  feeAmount: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  deliveryFeeAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  discountAmount: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  taxAmount: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  totalAmount: number;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING_PAYMENT,
  })
  @Index()
  status: OrderStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  paidAt?: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  deliveredAt?: Date;

  // Fecha límite para completar el pago antes de liberar reservas
  @Column({ type: 'timestamp with time zone' })
  @Index()
  expiresAt: Date;

  // Auditoría legal de aceptación de Términos y Condiciones
  @Column({ type: 'boolean', default: false })
  termsAccepted: boolean;

  @Column({ type: 'timestamp with time zone', nullable: true })
  termsAcceptedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  termsPermalink?: string | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true, eager: true })
  items: OrderItem[];

  @OneToMany(() => StockReservation, (sr) => sr.order)
  stockReservations: StockReservation[];

  @OneToMany(() => Transaction, (tx) => tx.order)
  transactions?: Transaction[];

  @OneToOne(() => Delivery, (delivery) => delivery.order, { eager: true, nullable: true })
  delivery: Delivery;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
