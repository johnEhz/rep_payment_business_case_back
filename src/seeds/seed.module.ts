import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { Brand } from '../brands/entities/brand.entity';
import { Product } from '../products/entities/product.entity';
import { NotificationTemplate } from '../notifications/entities/notification-template.entity';
import { TaxCategory } from '../taxes/entities/tax-category.entity';
import { ProductPrice } from '../products/entities/product-price.entity';
import { SeedService } from './seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      Brand,
      Product,
      NotificationTemplate,
      TaxCategory,
      ProductPrice,
    ]),
  ],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
