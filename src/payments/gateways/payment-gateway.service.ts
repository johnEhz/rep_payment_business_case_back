import { Injectable, Logger } from '@nestjs/common';
import { IPaymentGateway, PaymentIntent, PaymentResult } from '../interfaces/payment-gateway.interface';
import { GatewayService } from '../../gateway/gateway.service';

@Injectable()
export class ExternalPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(ExternalPaymentGateway.name);

  constructor(private readonly gatewayService: GatewayService) {}

  async getMerchantData(): Promise<any> {
    return this.gatewayService.getMerchantData();
  }

  async createTransaction(intent: PaymentIntent): Promise<PaymentResult> {
    try {
      const response = await this.gatewayService.createTransaction({
        acceptanceToken: intent.acceptanceToken,
        amountInCents: intent.amountInCents,
        currency: intent.currency,
        customerEmail: intent.customerEmail,
        reference: intent.reference,
        cardToken: intent.cardToken,
        installments: intent.installments,
        redirectUrl: intent.redirectUrl,
        customerData: intent.customerData,
      });

      this.logger.log(`Gateway processed transaction for ${intent.reference}: status ${response?.status}`);

      let status: PaymentResult['status'] = 'ERROR';
      if (response?.status === 'APPROVED') status = 'APPROVED';
      else if (response?.status === 'DECLINED') status = 'DECLINED';
      else if (response?.status === 'VOIDED') status = 'VOIDED';
      else if (response?.status === 'PENDING') status = 'PENDING';

      return {
        providerTransactionId: response?.id || undefined,
        status,
        errorMessage: response?.error || response?.status_message,
        statusMessage: response?.status_message,
        rawResponse: response,
      };
    } catch (error: any) {
      this.logger.error(`Error in ExternalPaymentGateway for reference ${intent.reference}`, error?.message || error);
      return {
        status: 'ERROR',
        errorMessage: error?.message || 'Payment processing communication error',
      };
    }
  }

  async getTransactionStatus(transactionId: string): Promise<PaymentResult> {
    try {
      const response = await this.gatewayService.getTransactionStatus(transactionId);
      let status: PaymentResult['status'] = 'ERROR';
      if (response?.status === 'APPROVED') status = 'APPROVED';
      else if (response?.status === 'DECLINED') status = 'DECLINED';
      else if (response?.status === 'VOIDED') status = 'VOIDED';
      else if (response?.status === 'PENDING') status = 'PENDING';

      return {
        providerTransactionId: response?.id || transactionId,
        status,
        statusMessage: response?.status_message,
        rawResponse: response,
      };
    } catch (error: any) {
      return {
        providerTransactionId: transactionId,
        status: 'ERROR',
        errorMessage: error?.message || 'Failed to fetch transaction status',
      };
    }
  }

  validateWebhookSignature(body: any): boolean {
    return this.gatewayService.validateEventChecksum(body);
  }
}
