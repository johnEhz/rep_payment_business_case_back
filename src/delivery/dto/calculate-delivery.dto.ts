import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';

export class CalculateDeliveryDto {
  @IsNumber()
  @Min(0)
  totalPurchaseAmountInCents: number;

  @IsString()
  @IsNotEmpty()
  deliveryAddress: string;

  @IsString()
  @IsOptional()
  deliveryCity?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;
}
