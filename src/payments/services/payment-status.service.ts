import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../../orders/entities/order.entity';
import { Transaction, TransactionStatus } from '../../transactions/entities/transaction.entity';
import { Invoice } from '../../orders/entities/invoice.entity';
import { InventoryService } from '../../inventory/inventory.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditLogService } from '../../security/services/audit-log.service';
import { AuditSeverity } from '../../security/entities/audit-log.entity';
import { StockReservation, ReservationStatus } from '../../inventory/entities/stock-reservation.entity';
import { OrderTrackingService } from '../../orders/services/order-tracking.service';
import { PAYMENT_GATEWAY } from '../interfaces/payment-gateway.interface';
import type { IPaymentGateway } from '../interfaces/payment-gateway.interface';

export interface ApplyTransactionStatusParams {
  providerTransactionId?: string;
  reference: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR' | 'VOIDED' | 'EXPIRED' | 'CANCELLED';
  statusMessage?: string;
  rawData?: any;
  source: 'WEBHOOK' | 'RECONCILIATION' | 'PAYMENT_ENDPOINT' | 'POLLING';
}

@Injectable()
export class PaymentStatusService {
  private readonly logger = new Logger(PaymentStatusService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly inventoryService: InventoryService,
    private readonly deliveryService: DeliveryService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly orderTrackingService: OrderTrackingService,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Centraliza la actualización de pagos de forma 100% idempotente y atómica.
   * Actualiza Transaction y Order como estados independientes, pero vinculados lógicamente.
   */
  async applyTransactionStatus(params: ApplyTransactionStatusParams): Promise<{
    success: boolean;
    idempotent?: boolean;
    order?: Order;
    transaction?: Transaction;
    invoice?: Invoice | null;
    status: string;
  }> {
    const { providerTransactionId, reference, status, statusMessage, rawData, source } = params;
    this.logger.log(
      `[PaymentStatusService] Applying status ${status} for ref=${reference} (providerTxId=${providerTransactionId}) from ${source}`,
    );

    // 1. Buscar la transacción en base de datos
    let transaction = await this.transactionRepository.findOne({
      where: [
        ...(providerTransactionId ? [{ gatewayTransactionId: providerTransactionId }] : []),
        { reference },
      ],
      relations: { order: true },
    });

    // 2. Resolver la orden asociada
    let order: Order | null = null;
    if (transaction?.orderId) {
      order = await this.orderRepository.findOne({
        where: { id: transaction.orderId },
        relations: { items: { product: true }, delivery: true },
      });
    } else if (reference) {
      const orderNumberMatch = reference.match(/^([A-Z0-9]+-[A-Z0-9]+)/);
      if (orderNumberMatch) {
        order = await this.orderRepository.findOne({
          where: { orderNumber: orderNumberMatch[1] },
          relations: { items: { product: true }, delivery: true },
        });
      }
    }

    if (!order) {
      this.logger.warn(`[PaymentStatusService] Order not found for reference ${reference}`);
      return { success: false, status: 'ORDER_NOT_FOUND' };
    }

    // Si no había transacción previa registrada, crearla de forma segura
    if (!transaction) {
      transaction = this.transactionRepository.create({
        orderId: order.id,
        reference,
        amountInCents: Number(order.totalAmount),
        currency: order.currency || 'COP',
        paymentMethod: rawData?.payment_method_type || 'CARD',
        gatewayTransactionId: providerTransactionId || null,
        status: TransactionStatus.PENDING,
      });
      transaction = await this.transactionRepository.save(transaction);
    }

    // Actualizar datos del proveedor en transacción
    if (providerTransactionId && !transaction.gatewayTransactionId) {
      transaction.gatewayTransactionId = providerTransactionId;
    }
    if (statusMessage) {
      transaction.statusMessage = statusMessage;
    }

    const isOrderAlreadyApproved = order.status === OrderStatus.PAID || order.status === OrderStatus.DELIVERED;
    if (status === 'APPROVED' && isOrderAlreadyApproved) {
      this.logger.log(
        `[PaymentStatusService] Idempotency: Order ${order.orderNumber} already marked as ${order.status}. Ensuring invoice exists.`,
      );

      let invoice = await this.invoiceRepository.findOne({ where: { orderId: order.id } });
      if (!invoice) {
        invoice = await this.createInvoiceForOrder(order, transaction);
      }

      return {
        success: true,
        idempotent: true,
        order,
        transaction,
        invoice,
        status: 'ALREADY_APPROVED',
      };
    }

    if (status === 'APPROVED') {
      const rawAmount = rawData?.amount_in_cents ?? rawData?.amountInCents;
      if (rawAmount !== undefined && rawAmount !== null) {
        const receivedAmount = Number(rawAmount);
        const expectedAmount = Number(order.totalAmount);
        if (receivedAmount !== expectedAmount) {
          this.logger.error(
            `CRITICAL FINANCIAL TAMPERING DETECTED: Amount mismatch for order ${order.orderNumber}. Expected: ${expectedAmount}, Received: ${receivedAmount}`,
          );
          this.auditLogService.logEvent({
            action: 'PAYMENT_AMOUNT_MISMATCH',
            severity: AuditSeverity.CRITICAL,
            orderNumber: order.orderNumber,
            metadata: { expectedAmount, receivedAmount, source, reference },
          });
          transaction.status = TransactionStatus.ERROR;
          transaction.statusMessage = `Fraud alert: Amount mismatch (received ${receivedAmount}, expected ${expectedAmount})`;
          await this.transactionRepository.save(transaction);
          return { success: false, status: 'AMOUNT_MISMATCH', order, transaction, invoice: null };
        }
      }

      const rawCurrency = rawData?.currency;
      if (rawCurrency && rawCurrency.toUpperCase() !== (order.currency || 'COP').toUpperCase()) {
        this.logger.error(
          `CRITICAL CURRENCY MISMATCH: Order ${order.orderNumber} expected ${order.currency}, received ${rawCurrency}`,
        );
        this.auditLogService.logEvent({
          action: 'PAYMENT_CURRENCY_MISMATCH',
          severity: AuditSeverity.CRITICAL,
          orderNumber: order.orderNumber,
          metadata: { expectedCurrency: order.currency, receivedCurrency: rawCurrency, source, reference },
        });
        transaction.status = TransactionStatus.ERROR;
        transaction.statusMessage = `Currency mismatch (received ${rawCurrency}, expected ${order.currency})`;
        await this.transactionRepository.save(transaction);
        return { success: false, status: 'CURRENCY_MISMATCH', order, transaction, invoice: null };
      }

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let createdInvoice: Invoice | null = null;
      try {
        // A. Actualizar estado de la Transaction
        transaction.status = TransactionStatus.APPROVED;
        if (providerTransactionId) {
          transaction.gatewayTransactionId = providerTransactionId;
        }
        await queryRunner.manager.save(Transaction, transaction);

        // B. Actualizar estado de la Order a DELIVERED (o PAID)
        order.status = OrderStatus.DELIVERED;
        order.paidAt = new Date(rawData?.finalized_at || Date.now());
        order.deliveredAt = new Date();
        await queryRunner.manager.save(Order, order);

        // C. Confirmar reservas de inventario (o re-reservar atómicamente si fue expirada tardíamente)
        const activeReservationsCount = await queryRunner.manager.count(StockReservation, {
          where: { orderId: order.id, status: ReservationStatus.ACTIVE },
        });

        if (activeReservationsCount === 0) {
          this.logger.warn(
            `Order ${order.orderNumber} approved by gateway but active stock reservations were released. Attempting atomic re-reservation...`,
          );
          const cartItems = (order.items || []).map((i) => ({ productId: i.productId, quantity: i.quantity }));
          try {
            await this.inventoryService.reserveStock(
              queryRunner.manager,
              order.id,
              cartItems,
              new Date(Date.now() + 60 * 60 * 1000),
            );
          } catch (stockErr: any) {
            this.logger.error(
              `CRITICAL OVERSELLING WARNING: Stock unavailable for paid order ${order.orderNumber}: ${stockErr?.message}`,
            );
            this.auditLogService.logEvent({
              action: 'PAYMENT_APPROVED_NO_STOCK',
              severity: AuditSeverity.CRITICAL,
              orderNumber: order.orderNumber,
              metadata: { error: stockErr?.message, providerTransactionId, source },
            });
            // Continúa para permitir gestión operativa de stock o reembolso
          }
        }

        await this.inventoryService.confirmReservations(queryRunner.manager, order.id);

        // D. Crear despacho / delivery (Idempotente)
        await this.deliveryService.createDeliveryForOrder(queryRunner.manager, order);

        // E. Crear Factura (Invoice) de forma idempotente
        const existingInvoice = await queryRunner.manager.findOne(Invoice, { where: { orderId: order.id } });
        if (!existingInvoice) {
          createdInvoice = queryRunner.manager.create(Invoice, {
            invoiceNumber: `INV-${order.orderNumber}`,
            orderId: order.id,
            transactionId: transaction.id,
            customerName: order.customerName,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            subtotalAmount: order.subtotalAmount,
            feeAmount: order.feeAmount || 0,
            deliveryFeeAmount: order.deliveryFeeAmount || 0,
            discountAmount: order.discountAmount || 0,
            taxAmount: order.taxAmount || 0,
            totalAmount: order.totalAmount,
            currency: order.currency || 'COP',
            issuedAt: new Date(),
            metadata: {
              source,
              reference: transaction.reference,
              providerTransactionId,
            },
          });
          createdInvoice = await queryRunner.manager.save(Invoice, createdInvoice);
        } else {
          createdInvoice = existingInvoice;
        }

        await queryRunner.commitTransaction();
        this.logger.log(`[PaymentStatusService] Order ${order.orderNumber} successfully marked as APPROVED and DELIVERED via ${source}`);
      } catch (err: any) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`[PaymentStatusService] Failed to commit APPROVED status for ${order.orderNumber}`, err);
        throw err;
      } finally {
        await queryRunner.release();
      }

      // F. Efectos posteriores asíncronos (notificaciones y auditoría)
      const updatedOrder = await this.orderTrackingService.trackOrder(order.orderNumber, order.accessToken);

      this.auditLogService.logEvent({
        action: 'PAYMENT_APPROVED',
        severity: AuditSeverity.INFO,
        orderNumber: order.orderNumber,
        checkoutSessionId: order.checkoutSessionId || null,
        metadata: {
          source,
          transactionId: transaction.id,
          providerTransactionId,
          amountInCents: transaction.amountInCents,
          invoiceNumber: createdInvoice?.invoiceNumber,
        },
      });

      this.notificationsService
        .sendPaymentApproved(updatedOrder, transaction)
        .catch((err) => {
          this.logger.warn(`Could not send payment approved SES email: ${err?.message || err}`);
        });

      return {
        success: true,
        order: updatedOrder as any,
        transaction,
        invoice: createdInvoice,
        status: 'APPROVED',
      };
    }

    if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
      const finalTxStatus =
        status === 'DECLINED'
          ? TransactionStatus.DECLINED
          : status === 'VOIDED'
          ? TransactionStatus.VOIDED
          : TransactionStatus.ERROR;

      transaction.status = finalTxStatus;
      if (statusMessage) {
        transaction.statusMessage = statusMessage;
      }
      if (providerTransactionId) {
        transaction.gatewayTransactionId = providerTransactionId;
      }
      await this.transactionRepository.save(transaction);

      // Verificar intentos fallidos totales para la orden
      const MAX_PAYMENT_ATTEMPTS = 3;
      const totalAttempts = await this.transactionRepository.count({
        where: { orderId: order.id },
      });

      const isExpired = new Date() > new Date(order.expiresAt);
      const isLimitReached = totalAttempts >= MAX_PAYMENT_ATTEMPTS || isExpired;

      if (isLimitReached) {
        order.status = isExpired ? OrderStatus.EXPIRED : OrderStatus.CANCELLED;
        await this.orderRepository.save(order);
        await this.inventoryService.releaseReservations(
          this.orderRepository.manager,
          order.id,
          ReservationStatus.RELEASED,
        );
        this.logger.warn(
          `[PaymentStatusService] Order ${order.orderNumber} reached max attempts (${totalAttempts}/${MAX_PAYMENT_ATTEMPTS}) or expired. Marked as ${order.status} and stock released.`,
        );
      } else {
        order.status = OrderStatus.PENDING_PAYMENT;
        await this.orderRepository.save(order);
      }

      this.auditLogService.logEvent({
        action: 'PAYMENT_DECLINED',
        severity: isLimitReached ? AuditSeverity.CRITICAL : AuditSeverity.WARN,
        orderNumber: order.orderNumber,
        checkoutSessionId: order.checkoutSessionId || null,
        metadata: {
          source,
          transactionId: transaction.id,
          providerTransactionId,
          attemptsCount: totalAttempts,
          statusMessage,
        },
      });

      this.notificationsService
        .sendPaymentDeclined(order, statusMessage || 'El pago fue declinado por la entidad financiera.')
        .catch((err) => {
          this.logger.warn(`Could not send payment declined SES email: ${err?.message || err}`);
        });

      return {
        success: false,
        order,
        transaction,
        invoice: null,
        status: finalTxStatus,
      };
    }

    if (status === 'PENDING') {
      transaction.status = TransactionStatus.PENDING;
      if (providerTransactionId) {
        transaction.gatewayTransactionId = providerTransactionId;
      }
      await this.transactionRepository.save(transaction);

      order.status = OrderStatus.PENDING_PAYMENT;
      await this.orderRepository.save(order);

      return {
        success: true,
        order,
        transaction,
        invoice: null,
        status: 'PENDING',
      };
    }

    if (status === 'EXPIRED' || status === 'CANCELLED') {
      transaction.status = status === 'EXPIRED' ? TransactionStatus.EXPIRED : TransactionStatus.CANCELLED;
      await this.transactionRepository.save(transaction);

      order.status = status === 'EXPIRED' ? OrderStatus.EXPIRED : OrderStatus.CANCELLED;
      await this.orderRepository.save(order);
      await this.inventoryService.releaseReservations(
        this.orderRepository.manager,
        order.id,
        ReservationStatus.RELEASED,
      );

      return {
        success: false,
        order,
        transaction,
        invoice: null,
        status: transaction.status,
      };
    }

    return {
      success: true,
      order,
      transaction,
      status: transaction.status,
    };
  }

  /**
   * Consulta el estado en tiempo real del pago y orden desde la perspectiva del backend (fuente de verdad).
   */
  async getPaymentStatus(orderIdOrNumber: string, token?: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdOrNumber);

    const order = await this.orderRepository.findOne({
      where: isUuid ? { id: orderIdOrNumber } : { orderNumber: orderIdOrNumber },
      relations: { delivery: true },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderIdOrNumber} not found`);
    }

    if (token && order.accessToken !== token) {
      throw new UnauthorizedException('Token de acceso inválido para esta orden');
    }

    // Buscar la última transacción registrada
    let latestTransaction = await this.transactionRepository.findOne({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });

    if (latestTransaction?.status === TransactionStatus.PENDING && latestTransaction.gatewayTransactionId) {
      try {
        const gatewayResult = await this.paymentGateway.getTransactionStatus(
          latestTransaction.gatewayTransactionId,
        );

        if (gatewayResult?.status && gatewayResult.status !== 'PENDING') {
          this.logger.log(
            `[PaymentStatusService] JIT status poll: Gateway resolved ${latestTransaction.reference} to ${gatewayResult.status}. Applying...`,
          );

          await this.applyTransactionStatus({
            providerTransactionId: latestTransaction.gatewayTransactionId,
            reference: latestTransaction.reference,
            status: gatewayResult.status as any,
            statusMessage: gatewayResult.statusMessage || gatewayResult.errorMessage,
            rawData: gatewayResult.rawResponse,
            source: 'POLLING',
          });

          // Refrescar datos actualizados de la orden y transacción
          const reloadedOrder = await this.orderRepository.findOne({
            where: { id: order.id },
            relations: { delivery: true },
          });
          if (reloadedOrder) {
            order.status = reloadedOrder.status;
            order.paidAt = reloadedOrder.paidAt;
            order.deliveredAt = reloadedOrder.deliveredAt;
            order.updatedAt = reloadedOrder.updatedAt;
          }

          latestTransaction = await this.transactionRepository.findOne({
            where: { id: latestTransaction.id },
          });
        }
      } catch (pollErr: any) {
        this.logger.warn(
          `[PaymentStatusService] JIT status poll warning for ${latestTransaction?.reference || 'tx'}: ${pollErr?.message || pollErr}`,
        );
      }
    }

    // Buscar si existe una transacción PENDING activa
    const hasPendingTransaction =
      latestTransaction?.status === TransactionStatus.PENDING;

    // Buscar factura generada (si existe)
    const invoice = await this.invoiceRepository.findOne({
      where: { orderId: order.id },
    });

    const isPaid = order.status === OrderStatus.PAID || order.status === OrderStatus.DELIVERED;
    const isCancelled = order.status === OrderStatus.CANCELLED || order.status === OrderStatus.EXPIRED;
    const isExpired = new Date() > new Date(order.expiresAt);

    // Contar intentos fallidos
    const attemptsCount = await this.transactionRepository.count({
      where: { orderId: order.id },
    });

    const canRetry = !hasPendingTransaction && !isPaid && !isCancelled && !isExpired && attemptsCount < 3;

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      isPaymentPending: hasPendingTransaction,
      canRetry,
      attemptsCount,
      maxAttempts: 3,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt || null,
      deliveredAt: order.deliveredAt || null,
      activeTransaction: latestTransaction
        ? {
            id: latestTransaction.id,
            reference: latestTransaction.reference,
            gatewayTransactionId: latestTransaction.gatewayTransactionId || null,
            status: latestTransaction.status,
            statusMessage: latestTransaction.statusMessage || null,
            amountInCents: Number(latestTransaction.amountInCents),
            paymentMethod: latestTransaction.paymentMethod,
            installments: latestTransaction.installments,
            createdAt: latestTransaction.createdAt,
            updatedAt: latestTransaction.updatedAt,
          }
        : null,
      invoice: invoice
        ? {
            invoiceNumber: invoice.invoiceNumber,
            totalAmount: Number(invoice.totalAmount),
            issuedAt: invoice.issuedAt,
          }
        : null,
      updatedAt: order.updatedAt,
    };
  }

  /**
   * Helper privado para generar la factura de una orden aprobada de forma idempotente
   */
  private async createInvoiceForOrder(order: Order, transaction?: Transaction): Promise<Invoice> {
    const existing = await this.invoiceRepository.findOne({ where: { orderId: order.id } });
    if (existing) return existing;

    const invoice = this.invoiceRepository.create({
      invoiceNumber: `INV-${order.orderNumber}`,
      orderId: order.id,
      transactionId: transaction?.id || null,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      subtotalAmount: order.subtotalAmount,
      feeAmount: order.feeAmount || 0,
      deliveryFeeAmount: order.deliveryFeeAmount || 0,
      discountAmount: order.discountAmount || 0,
      taxAmount: order.taxAmount || 0,
      totalAmount: order.totalAmount,
      currency: order.currency || 'COP',
      issuedAt: new Date(),
    });

    return this.invoiceRepository.save(invoice);
  }
}
