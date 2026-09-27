import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';

export enum TaxType {
  VAT = 'VAT',
  EXEMPT = 'EXEMPT',
  REDUCED = 'REDUCED',
}

export const numericTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | number | null | undefined): number =>
    value !== null && value !== undefined ? Number(value) : 0,
};

@Entity('tax_categories')
export class TaxCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 19.0,
    transformer: numericTransformer,
  })
  rate: number;

  @Column({
    type: 'enum',
    enum: TaxType,
    default: TaxType.VAT,
  })
  type: TaxType;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => Product, (product) => product.taxCategory)
  products: Product[];

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt: Date;
}
