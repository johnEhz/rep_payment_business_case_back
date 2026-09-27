import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandResponseDto } from './dto/brand-response.dto';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  async findAll(): Promise<BrandResponseDto[]> {
    return this.brandsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<BrandResponseDto> {
    return this.brandsService.findOne(id);
  }

  @Get('slug/:slug')
  async findBySlug(@Param('slug') slug: string): Promise<BrandResponseDto> {
    return this.brandsService.findBySlug(slug);
  }
}
