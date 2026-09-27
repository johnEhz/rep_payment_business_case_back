export interface PaymentIntent {
  amountInCents: number;
  currency: string;
  reference: string;
  customerEmail: string;
  acceptanceToken: string;
  cardToken: string;
  installments?: number;
  redirectUrl?: string;
  customerData?: {
    phoneNumber?: string;
    fullName?: string;
    legalId?: string;
    legalIdType?: string;
  };
}

export interface PaymentResult {
  providerTransactionId?: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';
  errorMessage?: string;
  statusMessage?: string;
  rawResponse?: any;
}

export interface IPaymentGateway {
  getMerchantData(): Promise<any>;
  createTransaction(intent: PaymentIntent): Promise<PaymentResult>;
  getTransactionStatus(transactionId: string): Promise<PaymentResult>;
  validateWebhookSignature?(body: any): boolean;
}

export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';
