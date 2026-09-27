import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductPrice } from './entities/product-price.entity';
import { ProductsService } from './products.service';
import { PricingService } from './services/pricing.service';
import { ProductsController } from './products.controller';
import { TaxesModule } from '../taxes/taxes.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, ProductPrice]),
    TaxesModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, PricingService],
  exports: [ProductsService, PricingService, TypeOrmModule],
})
export class ProductsModule {}
