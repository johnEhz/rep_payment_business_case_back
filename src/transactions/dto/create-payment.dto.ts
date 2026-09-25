import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  IsOptional,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;

  @IsString()
  @IsNotEmpty()
  customerFullName: string;

  @IsEmail()
  @IsNotEmpty()
  customerEmail: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsNotEmpty()
  deliveryAddress: string;

  @IsString()
  @IsNotEmpty()
  deliveryCity: string;

  @IsString()
  @IsOptional()
  deliveryNotes?: string;

  @IsString()
  @IsNotEmpty()
  acceptanceToken: string;

  @IsString()
  @IsNotEmpty()
  cardToken: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  installments?: number = 1;
}
