import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Product } from '../../products/entities/product.entity';
import { InventoryService } from '../../inventory/inventory.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { LocationsService } from '../../locations/locations.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { CreateGuestOrderDto } from '../dto/create-guest-order.dto';
import { OrderResponseDto } from '../dto/order-response.dto';
import { OrderTrackingService } from './order-tracking.service';
import { CheckoutSessionService } from './checkout-session.service';
import { CheckoutSession } from '../entities/checkout-session.entity';
import { PricingService } from '../../products/services/pricing.service';
import { AuditLogService } from '../../security/services/audit-log.service';
import { AuditSeverity } from '../../security/entities/audit-log.entity';

@Injectable()
export class OrderCreationService {
  private readonly logger = new Logger(OrderCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly deliveryService: DeliveryService,
    private readonly locationsService: LocationsService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly orderTrackingService: OrderTrackingService,
    private readonly checkoutSessionService: CheckoutSessionService,
    private readonly pricingService: PricingService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Creación o reutilización de orden para cliente invitado con reserva atómica de inventario (15 min)
   */
  async createGuestOrder(
    dto: CreateGuestOrderDto,
    session?: CheckoutSession,
  ): Promise<OrderResponseDto> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order items cannot be empty');
    }

    // 1. Si existía una orden pendiente previa en esta sesión, cancelarla limpiamente para que la nueva orden
    // se cree con su propio número de orden, nuevos 15 minutos de vigencia y nueva reserva atómica.
    if (session) {
      const activeOrder = await this.checkoutSessionService.findActivePendingOrder(session.id);
      if (activeOrder) {
        await this.checkoutSessionService.cancelActiveOrder(session.id);
        this.logger.log(`Cancelled previous pending order ${activeOrder.orderNumber} to create a fresh new order for session ${session.id}.`);
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const orderNumber = `JHM-${Math.floor(10000 + Math.random() * 90000)}`;
      const accessToken = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      let totalBaseAmount = 0;
      let totalTaxAmount = 0;
      let productsTotalAmount = 0;
      const orderItemsToCreate: Partial<OrderItem>[] = [];

      for (const item of dto.items) {
        const product = await queryRunner.manager.findOne(Product, {
          where: { id: item.productId },
          relations: { taxCategory: true },
        });

        if (!product) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }

        const pricing = await this.pricingService.calculateItemPrice(product, item.quantity);
        totalBaseAmount += pricing.subtotal;
        totalTaxAmount += pricing.taxAmount;
        productsTotalAmount += pricing.totalAmount;

        orderItemsToCreate.push({
          productId: product.id,
          productName: product.name,
          unitPrice: pricing.unitPrice,
          unitBasePrice: pricing.unitBasePrice,
          taxRate: pricing.taxRate,
          taxAmount: pricing.taxAmount,
          subtotal: pricing.subtotal,
          quantity: pricing.quantity,
          totalAmount: pricing.totalAmount,
        });
      }

      const validLoc = await this.locationsService.validateSupportedLocation(
        dto.deliveryCountry,
        dto.deliveryDepartment,
        dto.deliveryCity,
      );

      const inputCoords =
        dto.deliveryLatitude && dto.deliveryLongitude
          ? { latitude: dto.deliveryLatitude, longitude: dto.deliveryLongitude }
          : undefined;

      const geoResult = !inputCoords
        ? await this.deliveryService.geocodeAddress(dto.deliveryAddress, validLoc.city)
        : null;

      const resolvedCoords =
        inputCoords ||
        (geoResult ? { latitude: geoResult.latitude, longitude: geoResult.longitude } : undefined);

      const deliveryCalc = await this.deliveryService.calculateDeliveryFee(
        productsTotalAmount,
        dto.deliveryAddress,
        validLoc.city,
        resolvedCoords,
      );

      const baseFeeAmount = Number(this.configService.get<number>('BASE_FEE_IN_CENTS', 300000));
      const deliveryFeeAmount = deliveryCalc.finalDeliveryFeeInCents;
      const discountAmount = deliveryCalc.discountInCents || 0;
      const totalAmount = productsTotalAmount + deliveryFeeAmount + baseFeeAmount;

      let order = queryRunner.manager.create(Order, {
        orderNumber,
        accessToken,
        checkoutSessionId: session ? session.id : undefined,
        customerId: null,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        customerPhoneExtension: dto.customerPhoneExtension || null,
        deliveryAddress: dto.deliveryAddress,
        deliveryNeighborhood: dto.deliveryNeighborhood || null,
        deliveryCity: validLoc.city,
        deliveryDepartment: validLoc.department,
        deliveryCountry: validLoc.country,
        deliveryLatitude: resolvedCoords ? resolvedCoords.latitude : undefined,
        deliveryLongitude: resolvedCoords ? resolvedCoords.longitude : undefined,
        currency: 'COP',
        subtotalAmount: totalBaseAmount,
        taxAmount: totalTaxAmount,
        feeAmount: baseFeeAmount,
        deliveryFeeAmount,
        discountAmount,
        totalAmount,
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt,
        termsAccepted: Boolean(dto.termsAccepted),
        termsAcceptedAt: dto.termsAccepted ? new Date() : null,
        termsPermalink: dto.termsPermalink || null,
      });

      order = await queryRunner.manager.save(Order, order);

      for (const itemData of orderItemsToCreate) {
        itemData.orderId = order.id;
        const item = queryRunner.manager.create(OrderItem, itemData);
        await queryRunner.manager.save(OrderItem, item);
      }

      // Reserva de stock con bloqueo pesimista en la transacción
      await this.inventoryService.reserveStock(
        queryRunner.manager,
        order.id,
        dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        expiresAt,
      );

      await queryRunner.commitTransaction();
      this.logger.log(`Guest Order ${order.orderNumber} created successfully. Expires at ${expiresAt.toISOString()}`);

      const createdOrder = await this.orderTrackingService.trackOrder(order.orderNumber, accessToken);

      this.auditLogService.logEvent({
        action: 'ORDER_CREATED',
        severity: AuditSeverity.INFO,
        orderNumber: order.orderNumber,
        checkoutSessionId: session ? session.id : null,
        metadata: {
          totalAmount: order.totalAmount,
          subtotalAmount: order.subtotalAmount,
          taxAmount: order.taxAmount,
          customerEmail: order.customerEmail,
          deliveryCity: order.deliveryCity,
          itemsCount: orderItemsToCreate.length,
        },
      });

      // Notificar al usuario por correo de forma asíncrona
      this.notificationsService
        .sendOrderCreated(createdOrder, createdOrder.items || [])
        .catch((err) => {
          this.logger.warn(`Could not dispatch order created notification: ${err?.message || err}`);
        });

      return createdOrder;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to create guest order', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
