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
import { Product } from './product.entity';
import { bigintTransformer } from '../../orders/entities/order.entity';

@Entity('product_prices')
export class ProductPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  productId: string;

  @ManyToOne(() => Product, (product) => product.prices, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  // Precio final comercial al consumidor en minor units (centavos de COP)
  @Column({ type: 'bigint', transformer: bigintTransformer })
  price: number;

  @Column({ type: 'varchar', length: 3, default: 'COP' })
  currency: string;

  // Indica si el precio incluye IVA (estándar para ecommerce B2C en Colombia)
  @Column({ type: 'boolean', default: true })
  taxIncluded: boolean;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  validFrom: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  @Index()
  validTo: Date | null;

  @Column({ type: 'boolean', default: true })
  @Index()
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
