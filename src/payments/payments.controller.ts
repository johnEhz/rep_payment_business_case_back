import { Controller, Get, Inject } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { IPaymentGateway } from './interfaces/payment-gateway.interface';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
  ) {}

  @Get('merchant')
  async getMerchantData() {
    return this.paymentGateway.getMerchantData();
  }

  @Get('tokenizer')
  async getTokenizerConfig() {
    return this.paymentGateway.getMerchantData();
  }
}
