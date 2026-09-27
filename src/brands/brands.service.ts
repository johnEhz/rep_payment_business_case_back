import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from './entities/brand.entity';
import {
  BrandResponseDto,
  toBrandResponseDto,
} from './dto/brand-response.dto';

@Injectable()
export class BrandsService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
  ) {}

  async findAll(): Promise<BrandResponseDto[]> {
    const brands = await this.brandRepository.find({
      order: { name: 'ASC' },
    });
    return brands.map(toBrandResponseDto);
  }

  async findOne(id: string): Promise<BrandResponseDto> {
    const brand = await this.findEntityById(id);
    return toBrandResponseDto(brand);
  }

  async findBySlug(slug: string): Promise<BrandResponseDto> {
    const brand = await this.brandRepository.findOne({
      where: { slug },
    });
    if (!brand) {
      throw new NotFoundException(`Brand with slug "${slug}" not found`);
    }
    return toBrandResponseDto(brand);
  }

  async findEntityById(id: string): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: { id },
    });
    if (!brand) {
      throw new NotFoundException(`Brand with ID ${id} not found`);
    }
    return brand;
  }
}
