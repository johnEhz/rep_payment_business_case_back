import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxCategory, TaxType } from './entities/tax-category.entity';

@Injectable()
export class TaxesService {
  constructor(
    @InjectRepository(TaxCategory)
    private readonly taxCategoryRepository: Repository<TaxCategory>,
  ) {}

  async findAll(): Promise<TaxCategory[]> {
    return this.taxCategoryRepository.find({
      where: { isActive: true },
      order: { rate: 'DESC' },
    });
  }

  async findById(id: string): Promise<TaxCategory> {
    const tax = await this.taxCategoryRepository.findOne({ where: { id } });
    if (!tax) {
      throw new NotFoundException(`Tax category with ID ${id} not found`);
    }
    return tax;
  }

  async findByCode(code: string): Promise<TaxCategory | null> {
    return this.taxCategoryRepository.findOne({ where: { code } });
  }

  async getDefaultTaxCategory(): Promise<TaxCategory> {
    const standard = await this.findByCode('VAT_19');
    if (standard) return standard;

    const anyVat = await this.taxCategoryRepository.findOne({
      where: { type: TaxType.VAT, isActive: true },
      order: { rate: 'DESC' },
    });
    if (anyVat) return anyVat;

    // Fallback: create default 19%
    const defaultCat = this.taxCategoryRepository.create({
      name: 'IVA General 19%',
      code: 'VAT_19',
      rate: 19.0,
      type: TaxType.VAT,
      isActive: true,
    });
    return this.taxCategoryRepository.save(defaultCat);
  }
}
