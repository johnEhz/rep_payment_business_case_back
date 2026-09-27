import { Injectable, InternalServerErrorException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';

export interface AcceptanceTokenResponse {
  acceptanceToken: string;
  permalink: string;
  publicKey: string;
  gatewayApiUrl?: string;
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
  redirect_url?: string;
  customer_data?: {
    phone_number?: string;
    full_name?: string;
    legal_id?: string;
    legal_id_type?: string;
  };
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);
  private readonly apiUrl: string;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly integritySecret: string;
  private readonly eventsSecret: string;
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiUrl = this.configService.get<string>('GATEWAY_API_URL') || process.env.GATEWAY_API_URL || '';
    this.publicKey = this.configService.get<string>('GATEWAY_PUBLIC_KEY', '');
    this.privateKey = this.configService.get<string>('GATEWAY_PRIVATE_KEY', '');
    this.integritySecret = this.configService.get<string>('GATEWAY_INTEGRITY_SECRET', '');
    this.eventsSecret = this.configService.get<string>('GATEWAY_EVENTS_SECRET', '');
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
      const presignedAcceptance = response.data?.data?.presigned_acceptance;

      return {
        acceptanceToken: presignedAcceptance?.acceptance_token || '',
        permalink: presignedAcceptance?.permalink || '',
        publicKey: this.publicKey,
        gatewayApiUrl: this.apiUrl,
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
   * Valida la firma del evento de webhook usando el secreto de eventos
   */
  validateEventChecksum(eventPayload: any): boolean {
    if (!this.eventsSecret) {
      this.logger.error('CRITICAL: GATEWAY_EVENTS_SECRET is not configured. Webhook validation failed closed.');
      return false;
    }
    const signature = eventPayload?.signature;
    const timestamp = eventPayload?.timestamp;
    if (!signature || !signature.properties || !signature.checksum || timestamp === undefined) {
      this.logger.warn('Webhook payload missing signature, properties, checksum, or timestamp');
      return false;
    }

    // 1. Prevención de ataques de replay (Ventana de tolerancia de 10 minutos)
    const eventTimeMs = typeof timestamp === 'number' && timestamp < 1e11 ? timestamp * 1000 : Number(timestamp);
    const now = Date.now();
    if (isNaN(eventTimeMs) || Math.abs(now - eventTimeMs) > 10 * 60 * 1000) {
      this.logger.warn(`Webhook timestamp out of acceptable window (diff: ${Math.round((now - eventTimeMs) / 1000)}s)`);
      return false;
    }

    try {
      const parts: string[] = [];
      for (const propPath of signature.properties) {
        const keys = (propPath as string).split('.');
        let val: any = eventPayload.data;
        for (const k of keys) {
          val = val?.[k];
        }
        parts.push(String(val ?? ''));
      }
      parts.push(String(timestamp));
      parts.push(this.eventsSecret);

      const concatenated = parts.join('');
      const expectedChecksum = crypto.createHash('sha256').update(concatenated).digest('hex');

      const sigBuf = Buffer.from(String(signature.checksum).toLowerCase());
      const expBuf = Buffer.from(expectedChecksum.toLowerCase());

      if (sigBuf.length !== expBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch (err: any) {
      this.logger.error('Error validating event checksum', err?.message || err);
      return false;
    }
  }

  /**
   * Crea una transacción en la pasarela de pagos
   */
  async createTransaction(payload: {
    acceptanceToken: string;
    amountInCents: number;
    currency?: string;
    customerEmail: string;
    reference: string;
    cardToken: string;
    installments?: number;
    redirectUrl?: string;
    customerData?: {
      phoneNumber?: string;
      fullName?: string;
      legalId?: string;
      legalIdType?: string;
    };
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

    if (payload.redirectUrl) {
      body.redirect_url = payload.redirectUrl;
    }

    if (payload.customerData) {
      body.customer_data = {
        phone_number: payload.customerData.phoneNumber,
        full_name: payload.customerData.fullName,
        legal_id: payload.customerData.legalId,
        legal_id_type: payload.customerData.legalIdType,
      };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.apiUrl}/transactions`, body, {
          headers: {
            Authorization: `Bearer ${this.privateKey}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      const txData = response.data?.data;
      this.logger.log(
        `Gateway transaction created immediately: id=${txData?.id}, status=${txData?.status}, reference=${txData?.reference}`,
      );
      return txData;
    } catch (error: any) {
      this.logger.error('Error creating gateway transaction', error?.response?.data || error?.message || error);
      const errorData = error?.response?.data?.error;
      let errorDetail = 'Error al comunicarse con la pasarela de pagos';

      if (errorData?.messages && typeof errorData.messages === 'object') {
        const fieldTranslations: Record<string, string> = {
          acceptance_token: 'Token de aceptación',
          card_holder: 'Titular de la tarjeta',
          number: 'Número de tarjeta',
          cvc: 'CVC',
          amount_in_cents: 'Monto de la transacción',
          customer_email: 'Correo del cliente',
        };
        errorDetail = Object.entries(errorData.messages)
          .map(([field, errs]) => {
            const label = fieldTranslations[field] || field;
            const detail = Array.isArray(errs) ? errs.join(', ') : String(errs);
            return `${label}: ${detail}`;
          })
          .join('. ');
      } else if (errorData?.reason) {
        errorDetail = String(errorData.reason);
      } else if (errorData?.type) {
        errorDetail = String(errorData.type);
      } else if (error?.message) {
        errorDetail = String(error.message);
      }

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
            Authorization: `Bearer ${this.privateKey || this.publicKey}`,
          },
        }),
      );
      return response.data?.data;
    } catch (error: any) {
      this.logger.error(
        `Error querying gateway transaction ${gatewayTransactionId}`,
        error?.response?.data || error?.message || error,
      );
      throw new InternalServerErrorException('Failed to fetch transaction from payment gateway');
    }
  }
}
