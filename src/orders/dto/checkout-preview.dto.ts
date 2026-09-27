import { IsArray, ValidateNested, IsNotEmpty, IsString, IsOptional, IsUUID, IsInt, Min, Max, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CartItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1, { message: 'La cantidad mínima es 1 unidad' })
  @Max(100, { message: 'La cantidad máxima permitida por producto es 100 unidades' })
  quantity: number;
}

export class CheckoutPreviewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  // Campos honeypot invisibles para detectar bots automáticos
  @IsString()
  @IsOptional()
  _hp_check?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  fax?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  @IsString()
  @IsOptional()
  deliveryNeighborhood?: string;

  @IsString()
  @IsOptional()
  deliveryCity?: string = 'Medellín';

  @IsString()
  @IsOptional()
  deliveryDepartment?: string = 'Antioquia';

  @IsString()
  @IsOptional()
  deliveryCountry?: string = 'Colombia';

  @IsNumber()
  @IsOptional()
  deliveryLatitude?: number;

  @IsNumber()
  @IsOptional()
  deliveryLongitude?: number;
}
