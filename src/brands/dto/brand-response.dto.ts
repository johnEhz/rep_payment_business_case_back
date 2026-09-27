import { Brand } from '../entities/brand.entity';

export class BrandResponseDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export function toBrandResponseDto(brand: Brand): BrandResponseDto {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logoUrl: brand.logoUrl || null,
  };
}
