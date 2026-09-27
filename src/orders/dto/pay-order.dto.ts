import { IsNotEmpty, IsString, IsOptional, IsInt, Min } from 'class-validator';

export class PayOrderDto {
  @IsString()
  @IsNotEmpty()
  orderNumber: string;

  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @IsString()
  @IsOptional()
  acceptanceToken?: string;

  @IsString()
  @IsNotEmpty()
  cardToken: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  installments?: number = 1;

  // Campo honeypot para detectar bots de pago
  @IsString()
  @IsOptional()
  _hp_check?: string;
}
