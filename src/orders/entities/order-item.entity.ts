import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Order, bigintTransformer } from './order.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column({ type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product: Product;

  // Snapshot inmutable de la información al momento de compra
  @Column({ type: 'varchar', length: 150 })
  productName: string;

  // Precio final comercial por unidad (con IVA incluido)
  @Column({ type: 'bigint', transformer: bigintTransformer })
  unitPrice: number;

  // Precio base antes de impuesto por unidad
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  unitBasePrice: number;

  // Tasa de impuesto aplicada (ej: 19.00)
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 19.0,
    transformer: {
      to: (v: number) => v,
      from: (v: string | number) => Number(v || 0),
    },
  })
  taxRate: number;

  // Monto total de impuesto para esta línea (taxAmount = (unitPrice - unitBasePrice) * quantity)
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  taxAmount: number;

  // Subtotal base total de la línea sin impuestos (subtotal = unitBasePrice * quantity)
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  subtotal: number;

  @Column({ type: 'int' })
  quantity: number;

  // Total comercial final de la línea (totalAmount = unitPrice * quantity)
  @Column({ type: 'bigint', transformer: bigintTransformer })
  totalAmount: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;
}
