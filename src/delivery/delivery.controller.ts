import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DeliveryService, DeliveryCalculationResult } from './delivery.service';
import { CalculateDeliveryDto } from './dto/calculate-delivery.dto';
import { DeliveryStatus } from './entities/delivery.entity';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post('calculate')
  async calculate(@Body() dto: CalculateDeliveryDto): Promise<DeliveryCalculationResult> {
    const coords =
      dto.latitude && dto.longitude
        ? { latitude: dto.latitude, longitude: dto.longitude }
        : undefined;

    return this.deliveryService.calculateDeliveryFee(
      dto.totalPurchaseAmountInCents,
      dto.deliveryAddress,
      dto.deliveryCity || 'Medellín',
      coords,
    );
  }

  @Get('estimate')
  async estimate(
    @Query('amountInCents', ParseIntPipe) amountInCents: number,
    @Query('address') address: string,
    @Query('city', new DefaultValuePipe('Medellín')) city: string,
  ): Promise<DeliveryCalculationResult> {
    return this.deliveryService.calculateDeliveryFee(amountInCents, address, city);
  }

  @Get('order/:orderId')
  async findByOrderId(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.deliveryService.findByOrderId(orderId);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body('status') status: DeliveryStatus,
    @Body('driverId') driverId?: string,
  ) {
    return this.deliveryService.updateStatus(id, status, driverId);
  }
}
