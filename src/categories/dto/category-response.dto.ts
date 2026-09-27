import { Category } from '../entities/category.entity';

export class CategoryResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export function toCategoryResponseDto(category: Category): CategoryResponseDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description || null,
  };
}
