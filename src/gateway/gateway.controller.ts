import { Controller, Get } from '@nestjs/common';
import { GatewayService } from './gateway.service';

@Controller('gateway')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Get('merchant')
  async getMerchant() {
    return this.gatewayService.getMerchantData();
  }
}
