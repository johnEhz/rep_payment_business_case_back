import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaxCategory } from './entities/tax-category.entity';
import { TaxesService } from './taxes.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaxCategory])],
  providers: [TaxesService],
  exports: [TaxesService, TypeOrmModule],
})
export class TaxesModule {}
