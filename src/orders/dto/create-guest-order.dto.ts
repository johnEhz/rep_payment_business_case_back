import {
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  IsBoolean,
  IsNumber,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CartItemDto } from './checkout-preview.dto';

export class CreateGuestOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsEmail()
  @IsNotEmpty()
  customerEmail: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsOptional()
  customerPhoneExtension?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'La dirección de entrega debe tener al menos 5 caracteres' })
  deliveryAddress: string;

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

  @IsString()
  @IsOptional()
  deliveryNotes?: string;

  @IsBoolean()
  @IsOptional()
  termsAccepted?: boolean;

  @IsString()
  @IsOptional()
  termsPermalink?: string;

  @IsString()
  @IsOptional()
  acceptanceToken?: string;

  // Campos honeypot invisibles para atrapar bots
  @IsString()
  @IsOptional()
  _hp_check?: string;

  @IsString()
  @IsOptional()
  website?: string;

  @IsString()
  @IsOptional()
  fax?: string;
}
