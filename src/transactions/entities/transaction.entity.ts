import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';

export enum TransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  VOIDED = 'VOIDED',
  ERROR = 'ERROR',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  reference: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  gatewayTransactionId: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  statusMessage: string;

  @Column({ type: 'bigint' })
  productAmountInCents: number;

  @Column({ type: 'bigint' })
  baseFeeInCents: number;

  @Column({ type: 'bigint' })
  deliveryFeeInCents: number;

  @Column({ type: 'bigint' })
  totalAmountInCents: number;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  @Column({ type: 'varchar', length: 150 })
  customerFullName: string;

  @Column({ type: 'varchar', length: 150 })
  customerEmail: string;

  @Column({ type: 'varchar', length: 30 })
  customerPhone: string;

  @Column({ type: 'varchar', length: 255 })
  deliveryAddress: string;

  @Column({ type: 'varchar', length: 100 })
  deliveryCity: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deliveryNotes: string;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
