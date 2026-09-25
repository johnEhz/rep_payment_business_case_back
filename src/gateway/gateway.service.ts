import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface AcceptanceTokenResponse {
  acceptanceToken: string;
  permalink: string;
  publicKey: string;
}

export interface GatewayTransactionPayload {
  acceptance_token: string;
  amount_in_cents: number;
  currency: string;
  customer_email: string;
  reference: string;
  payment_method: {
    type: 'CARD';
    token: string;
    installments: number;
  };
  signature: string;
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private readonly apiUrl: string;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly integritySecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiUrl = this.configService.get<string>('GATEWAY_API_URL', '');
    this.publicKey = this.configService.get<string>('GATEWAY_PUBLIC_KEY', '');
    this.privateKey = this.configService.get<string>('GATEWAY_PRIVATE_KEY', '');
    this.integritySecret = this.configService.get<string>('GATEWAY_INTEGRITY_SECRET', '');
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Obtiene la información del comercio y el token de aceptación de términos
   */
  async getMerchantData(): Promise<AcceptanceTokenResponse> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}/merchants/${this.publicKey}`),
      );
      const presignedAcceptance = response.data.data.presigned_acceptance;

      return {
        acceptanceToken: presignedAcceptance.acceptance_token,
        permalink: presignedAcceptance.permalink,
        publicKey: this.publicKey,
      };
    } catch (error: any) {
      this.logger.error('Error fetching merchant data', error?.response?.data || error?.message || error);
      throw new InternalServerErrorException('Failed to communicate with payment gateway service');
    }
  }

  /**
   * Genera la firma de integridad SHA-256 requerida por la pasarela de pagos
   * Fórmula: SHA256(reference + amountInCents + currency + integritySecret)
   */
  generateIntegritySignature(reference: string, amountInCents: number, currency = 'COP'): string {
    const rawString = `${reference}${amountInCents}${currency}${this.integritySecret}`;
    return crypto.createHash('sha256').update(rawString).digest('hex');
  }

  /**
   * Crea una transacción en la pasarela de pagos Sandbox
   */
  async createTransaction(payload: {
    acceptanceToken: string;
    amountInCents: number;
    currency?: string;
    customerEmail: string;
    reference: string;
    cardToken: string;
    installments?: number;
  }) {
    const currency = payload.currency || 'COP';
    const installments = payload.installments || 1;
    const signature = this.generateIntegritySignature(payload.reference, payload.amountInCents, currency);

    const body: GatewayTransactionPayload = {
      acceptance_token: payload.acceptanceToken,
      amount_in_cents: payload.amountInCents,
      currency,
      customer_email: payload.customerEmail,
      reference: payload.reference,
      payment_method: {
        type: 'CARD',
        token: payload.cardToken,
        installments,
      },
      signature,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.apiUrl}/transactions`, body, {
          headers: {
            Authorization: `Bearer ${this.privateKey}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      return response.data.data;
    } catch (error: any) {
      this.logger.error('Error creating gateway transaction', error?.response?.data || error?.message || error);
      const errorDetail = error?.response?.data?.error?.reason || error?.response?.data?.error?.messages || error?.message;
      return {
        status: 'ERROR',
        error: errorDetail,
      };
    }
  }

  /**
   * Consulta el estado de una transacción en la pasarela por su ID
   */
  async getTransactionStatus(gatewayTransactionId: string) {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}/transactions/${gatewayTransactionId}`, {
          headers: {
            Authorization: `Bearer ${this.publicKey}`,
          },
        }),
      );
      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Error querying gateway transaction ${gatewayTransactionId}`, error?.response?.data || error?.message || error);
      throw new InternalServerErrorException('Failed to fetch transaction from payment gateway');
    }
  }
}
