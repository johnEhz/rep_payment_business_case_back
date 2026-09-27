import { Product, slugify } from '../entities/product.entity';

export class ProductResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceInCents: number;
  stock: number;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  createdAt: Date;
}

export class ProductDetailResponseDto extends ProductResponseDto {
  images: string[];
}

export class PaginatedProductsResponseDto {
  data: ProductResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function toProductResponseDto(product: Product, availableStock?: number): ProductResponseDto {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug || slugify(product.name),
    description: product.description,
    priceInCents: Number(product.priceInCents),
    stock: typeof availableStock === 'number' ? availableStock : product.stock,
    imageUrl: product.imageUrl || null,
    category: product.category?.name || null,
    brand: product.brand?.name || null,
    createdAt: product.createdAt,
  };
}

export function toProductDetailResponseDto(product: Product, availableStock?: number): ProductDetailResponseDto {
  return {
    ...toProductResponseDto(product, availableStock),
    images: product.images || [],
  };
}
