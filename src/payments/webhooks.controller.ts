import {
  Controller,
  Post,
  Body,
  Inject,
  Logger,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PaymentStatusService } from './services/payment-status.service';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';
import type { IPaymentGateway } from './interfaces/payment-gateway.interface';

@Controller()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly paymentStatusService: PaymentStatusService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
  ) {}

  @Post('webhooks/gateway')
  @Post('webhooks/payment')
  @Post('payments/webhook')
  @Post('api/payments/webhook')
  @HttpCode(HttpStatus.OK)
  async handleGatewayWebhook(@Body() payload: any) {
    this.logger.log(`[GatewayWebhook] Received webhook event: ${payload?.event || 'unknown'}`);

    // 1. Validar la firma criptográfica (checksum)
    const isValidSignature = this.paymentGateway.validateWebhookSignature
      ? this.paymentGateway.validateWebhookSignature(payload)
      : false;

    if (!isValidSignature) {
      this.logger.warn('[GatewayWebhook] Rejected webhook event due to invalid signature/checksum');
      throw new UnauthorizedException('Firma o checksum de webhook inválido');
    }

    const txData = payload?.data?.transaction;
    if (!txData || !txData.id) {
      this.logger.warn('[GatewayWebhook] Webhook received without transaction data');
      throw new BadRequestException('Webhook payload missing transaction data');
    }

    // 2. Centralizar la actualización mediante el PaymentStatusService
    const result = await this.paymentStatusService.applyTransactionStatus({
      providerTransactionId: txData.id,
      reference: txData.reference,
      status: txData.status,
      statusMessage: txData.status_message,
      rawData: txData,
      source: 'WEBHOOK',
    });

    return {
      received: true,
      status: result.status,
      idempotent: result.idempotent || false,
    };
  }
}
