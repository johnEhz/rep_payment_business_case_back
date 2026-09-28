import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import type { Order } from './order.entity';

@Entity('checkout_sessions')
export class CheckoutSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  @Index()
  token: string;

  @Column({ type: 'jsonb', nullable: true })
  cartSnapshot?: { productId: string; quantity: number }[] | null;

  @Column({ type: 'timestamp with time zone' })
  @Index()
  expiresAt: Date;

  @OneToMany('Order', (order: any) => order.checkoutSession)
  orders: Order[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
