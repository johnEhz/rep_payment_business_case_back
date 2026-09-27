import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import { PayOrderDto } from '../dto/pay-order.dto';
import { toOrderResponseDto } from '../dto/order-response.dto';
import { PaymentsService } from '../../payments/payments.service';
import { PaymentStatusService } from '../../payments/services/payment-status.service';
import { InventoryService } from '../../inventory/inventory.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { StockReservation, ReservationStatus } from '../../inventory/entities/stock-reservation.entity';
import { Transaction, TransactionStatus } from '../../transactions/entities/transaction.entity';
import { OrderTrackingService } from './order-tracking.service';
import { AuditLogService } from '../../security/services/audit-log.service';
import { AuditSeverity } from '../../security/entities/audit-log.entity';
import { PAYMENT_GATEWAY } from '../../payments/interfaces/payment-gateway.interface';
import type { IPaymentGateway } from '../../payments/interfaces/payment-gateway.interface';

@Injectable()
export class OrderPaymentService {
  private readonly logger = new Logger(OrderPaymentService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => PaymentStatusService))
    private readonly paymentStatusService: PaymentStatusService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
    private readonly inventoryService: InventoryService,
    private readonly deliveryService: DeliveryService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
    private readonly orderTrackingService: OrderTrackingService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Procesa el pago de una orden y gestiona el ciclo de vida de inventario y despacho.
   * Si la pasarela responde PENDING, responde inmediatamente al frontend sin bloquear con polling.
   */
  async payOrder(dto: PayOrderDto) {
    const order = await this.orderRepository.findOne({
      where: { orderNumber: dto.orderNumber },
      relations: { items: { product: true }, delivery: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${dto.orderNumber} not found`);
    }

    if (order.accessToken !== dto.accessToken) {
      throw new UnauthorizedException('Invalid order access token');
    }

    if (order.status === OrderStatus.PAID || order.status === OrderStatus.DELIVERED) {
      return {
        success: true,
        status: 'APPROVED',
        message: 'Order is already completed and delivered',
        order: toOrderResponseDto(order),
      };
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT && order.status !== OrderStatus.PAYMENT_PENDING) {
      throw new BadRequestException(`Order cannot be paid in current status: ${order.status}`);
    }

    const pendingTransaction = await this.dataSource.getRepository(Transaction).findOne({
      where: { orderId: order.id, status: TransactionStatus.PENDING },
      order: { createdAt: 'DESC' },
    });

    if (pendingTransaction) {
      this.logger.warn(
        `Order ${order.orderNumber} already has a PENDING transaction (${pendingTransaction.id} / ${pendingTransaction.reference}). New payment attempt blocked.`,
      );
      throw new ConflictException({
        statusCode: 409,
        error: 'TRANSACTION_PENDING',
        message:
          'Ya existe una transacción de pago en proceso (PENDING) para esta orden. Por favor espera a que se confirme el estado antes de intentar nuevamente.',
        transaction: {
          id: pendingTransaction.id,
          reference: pendingTransaction.reference,
          status: pendingTransaction.status,
        },
      });
    }

    const MAX_PAYMENT_ATTEMPTS = 3;
    const previousAttemptsCount = await this.dataSource.getRepository(Transaction).count({
      where: { orderId: order.id },
    });

    if (previousAttemptsCount >= MAX_PAYMENT_ATTEMPTS) {
      this.logger.warn(
        `Order ${order.orderNumber} reached maximum payment attempts limit (${previousAttemptsCount}/${MAX_PAYMENT_ATTEMPTS}).`,
      );
      throw new BadRequestException(
        `Has superado el límite máximo de ${MAX_PAYMENT_ATTEMPTS} intentos de pago permitidos para esta orden. Por favor genera un nuevo pedido.`,
      );
    }

    const currentAttempt = previousAttemptsCount + 1;

    const now = new Date();
    if (now > new Date(order.expiresAt)) {
      order.status = OrderStatus.EXPIRED;
      await this.orderRepository.save(order);
      await this.inventoryService.releaseReservations(
        this.orderRepository.manager,
        order.id,
        ReservationStatus.EXPIRED,
      );
      this.logger.warn(`Order ${order.orderNumber} payment rejected: Order expired at ${order.expiresAt}.`);
      throw new BadRequestException(
        'La orden de compra ha vencido (tiempo límite de 15 minutos superado). El inventario reservado ha sido liberado. Por favor crea un nuevo pedido.',
      );
    }

    const activeReservationsCount = await this.dataSource.getRepository(StockReservation).count({
      where: { orderId: order.id, status: ReservationStatus.ACTIVE },
    });

    if (activeReservationsCount === 0) {
      const cartItems = (order.items || []).map((i) => ({ productId: i.productId, quantity: i.quantity }));
      await this.inventoryService.validateCartStock(cartItems);

      const reserveRunner = this.dataSource.createQueryRunner();
      await reserveRunner.connect();
      await reserveRunner.startTransaction();

      try {
        await this.inventoryService.reserveStock(
          reserveRunner.manager,
          order.id,
          cartItems,
          new Date(order.expiresAt),
        );
        order.status = OrderStatus.PENDING_PAYMENT;
        await reserveRunner.manager.save(Order, order);
        await reserveRunner.commitTransaction();
        this.logger.log(`Stock re-reserved successfully for order ${order.orderNumber} retry.`);
      } catch (reserveError) {
        await reserveRunner.rollbackTransaction();
        throw reserveError;
      } finally {
        await reserveRunner.release();
      }
    }

    const { transaction, result } = await this.paymentsService.processPaymentAttempt(order, {
      acceptanceToken: dto.acceptanceToken,
      cardToken: dto.cardToken,
      installments: dto.installments,
    });

    if (result.status === 'PENDING') {
      this.logger.log(
        `Transaction ${transaction.reference} is PENDING.`,
      );

      return {
        success: false,
        status: 'PENDING',
        message: 'Tu pago está siendo procesado por la pasarela de pagos.',
        canRetry: false,
        transaction: {
          id: transaction.id,
          reference: transaction.reference,
          status: 'PENDING',
          totalAmountInCents: Number(transaction.amountInCents),
          paymentMethod: transaction.paymentMethod,
          installments: transaction.installments,
        },
        order: toOrderResponseDto(order),
      };
    }

    const outcome = await this.paymentStatusService.applyTransactionStatus({
      providerTransactionId: result.providerTransactionId,
      reference: transaction.reference,
      status: result.status as any,
      statusMessage: result.statusMessage || result.errorMessage,
      rawData: result.rawResponse,
      source: 'PAYMENT_ENDPOINT',
    });

    const isLimitReached = currentAttempt >= MAX_PAYMENT_ATTEMPTS;
    const canRetry = result.status !== 'APPROVED' && !isLimitReached && new Date() <= new Date(order.expiresAt);

    return {
      success: outcome.success,
      status: result.status,
      message:
        result.status === 'APPROVED'
          ? 'Pago aprobado exitosamente'
          : isLimitReached
          ? `Has alcanzado el límite máximo de ${MAX_PAYMENT_ATTEMPTS} intentos de pago. Tu orden ha sido cancelada.`
          : result.errorMessage || transaction.statusMessage || 'El pago fue rechazado por la pasarela de pagos.',
      canRetry,
      transaction: {
        id: transaction.id,
        reference: transaction.reference,
        status: outcome.transaction?.status || result.status,
        totalAmountInCents: Number(transaction.amountInCents),
        paymentMethod: transaction.paymentMethod,
        installments: transaction.installments,
      },
      order: outcome.order ? toOrderResponseDto(outcome.order) : toOrderResponseDto(order),
    };
  }
}
