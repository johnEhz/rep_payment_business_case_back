import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import {
  ProductResponseDto,
  ProductDetailResponseDto,
  PaginatedProductsResponseDto,
} from './dto/product-response.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('category') category?: string,
    @Query('brand') brand?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('inStockOnly') inStockOnly?: string,
  ): Promise<PaginatedProductsResponseDto> {
    return this.productsService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 12,
      search,
      categoryId,
      brandId,
      category,
      brand,
      minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      inStockOnly: inStockOnly === 'true' || inStockOnly === '1',
    });
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
  ): Promise<ProductDetailResponseDto> {
    return this.productsService.findOne(id);
  }
}

