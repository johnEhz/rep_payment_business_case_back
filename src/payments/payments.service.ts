import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Transaction, TransactionStatus } from '../transactions/entities/transaction.entity';
import { Order } from '../orders/entities/order.entity';
import type { IPaymentGateway, PaymentResult } from './interfaces/payment-gateway.interface';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @Inject(PAYMENT_GATEWAY)
    public readonly paymentGateway: IPaymentGateway,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Ejecuta un intento de pago contra la pasarela y registra la transacción en la base de datos vinculada a la orden
   */
  async processPaymentAttempt(
    order: Order,
    dto: {
      acceptanceToken?: string;
      cardToken: string;
      installments?: number;
    },
  ): Promise<{ transaction: Transaction; result: PaymentResult }> {
    const reference = `${order.orderNumber}-${Date.now()}`;

    // En la pasarela cada transacción requiere un acceptance_token fresco y vigente (de un solo uso por intento)
    let finalAcceptanceToken = dto.acceptanceToken || '';
    try {
      const merchant = await this.paymentGateway.getMerchantData();
      if (merchant?.acceptanceToken) {
        finalAcceptanceToken = merchant.acceptanceToken;
      }
    } catch (merchantErr: any) {
      this.logger.warn(
        `Could not refresh merchant acceptance token, using fallback: ${merchantErr?.message}`,
      );
    }

    // 1. Registrar la transacción en la tabla principal "transactions" vinculada a la orden
    const txData: DeepPartial<Transaction> = {
      reference,
      orderId: order.id,
      amountInCents: Number(order.totalAmount),
      currency: order.currency || 'COP',
      paymentMethod: 'CARD',
      installments: dto.installments || 1,
      acceptanceToken: finalAcceptanceToken,
      status: TransactionStatus.PENDING,
    };
    let transaction = this.transactionRepository.create(txData);
    transaction = await this.transactionRepository.save(transaction);
    this.logger.log(
      `Created database transaction ${transaction.id} (ref: ${reference}) for order ${order.orderNumber}`,
    );

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const redirectUrl = `${frontendUrl}/orders/track/${order.orderNumber}?token=${order.accessToken}`;

    // 2. Ejecutar cobro mediante la pasarela de pagos
    const result = await this.paymentGateway.createTransaction({
      amountInCents: Number(order.totalAmount),
      currency: order.currency,
      reference,
      customerEmail: order.customerEmail,
      acceptanceToken: finalAcceptanceToken,
      cardToken: dto.cardToken,
      installments: dto.installments || 1,
      redirectUrl,
      customerData: {
        phoneNumber: order.customerPhone,
        fullName: order.customerName,
      },
    });

    // 3. Actualizar registro con la respuesta de la pasarela
    transaction.gatewayTransactionId = result.providerTransactionId || null;
    const rawStatusMessage = result.statusMessage || result.errorMessage;
    transaction.statusMessage =
      typeof rawStatusMessage === 'string'
        ? rawStatusMessage
        : typeof rawStatusMessage === 'object' && rawStatusMessage !== null
        ? Object.entries(rawStatusMessage)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('. ')
        : null;

    if (result.status === 'APPROVED') {
      transaction.status = TransactionStatus.APPROVED;
    } else if (result.status === 'PENDING') {
      transaction.status = TransactionStatus.PENDING;
    } else if (result.status === 'DECLINED') {
      transaction.status = TransactionStatus.DECLINED;
    } else if (result.status === 'VOIDED') {
      transaction.status = TransactionStatus.VOIDED;
    } else {
      transaction.status = TransactionStatus.ERROR;
      transaction.statusMessage = result.errorMessage || 'Error en la comunicación con la pasarela';
    }

    transaction = await this.transactionRepository.save(transaction);

    return { transaction, result };
  }

  /**
   * Valida la firma del evento de webhook usando el Gateway provider
   */
  public validateWebhookSignature(body: any): boolean {
    if (this.paymentGateway.validateWebhookSignature) {
      return this.paymentGateway.validateWebhookSignature(body);
    }
    return true;
  }

  /**
   * Obtiene todos los intentos de pago asociados a una orden
   */
  async findByOrderId(orderId: string): Promise<Transaction[]> {
    return this.transactionRepository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }
}
