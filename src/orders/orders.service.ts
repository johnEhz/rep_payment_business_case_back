import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CheckoutPreviewDto } from './dto/checkout-preview.dto';
import { CreateGuestOrderDto } from './dto/create-guest-order.dto';
import { PayOrderDto } from './dto/pay-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { Order } from './entities/order.entity';
import { CheckoutSession } from './entities/checkout-session.entity';
import { OrderPreviewService } from './services/order-preview.service';
import { OrderCreationService } from './services/order-creation.service';
import { OrderPaymentService } from './services/order-payment.service';
import { OrderTrackingService } from './services/order-tracking.service';
import { CheckoutSessionService } from './services/checkout-session.service';
import { PaymentStatusService } from '../payments/services/payment-status.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly orderPreviewService: OrderPreviewService,
    private readonly orderCreationService: OrderCreationService,
    private readonly orderPaymentService: OrderPaymentService,
    private readonly orderTrackingService: OrderTrackingService,
    private readonly checkoutSessionService: CheckoutSessionService,
    @Inject(forwardRef(() => PaymentStatusService))
    private readonly paymentStatusService: PaymentStatusService,
  ) {}

  /**
   * Obtiene o crea la sesión segura de checkout del comprador
   */
  async getOrCreateSession(req?: any, res?: any): Promise<CheckoutSession> {
    return this.checkoutSessionService.getOrCreateSession(req, res);
  }

  /**
   * 1. Cotización y validación previa del carrito con verificación reactiva de stock
   */
  async previewCheckout(dto: CheckoutPreviewDto) {
    return this.orderPreviewService.previewCheckout(dto);
  }

  /**
   * 2. Creación o reutilización de orden para cliente invitado con reserva de inventario
   */
  async createGuestOrder(
    dto: CreateGuestOrderDto,
    session?: CheckoutSession,
  ): Promise<OrderResponseDto> {
    return this.orderCreationService.createGuestOrder(dto, session);
  }

  /**
   * 3. Proceso y confirmación del pago de la orden
   */
  async payOrder(dto: PayOrderDto) {
    return this.orderPaymentService.payOrder(dto);
  }

  /**
   * 4. Recuperación de la orden pendiente activa no expirada para la sesión actual
   */
  async getActivePendingOrder(
    sessionId: string,
  ): Promise<{ hasActiveOrder: boolean; order?: OrderResponseDto; remainingSeconds?: number }> {
    const activeOrder = await this.checkoutSessionService.findActivePendingOrder(sessionId);
    if (!activeOrder) {
      return { hasActiveOrder: false };
    }

    const orderDto = await this.orderTrackingService.trackOrder(
      activeOrder.orderNumber,
      activeOrder.accessToken,
    );
    const remainingSeconds = Math.max(
      0,
      Math.floor((new Date(activeOrder.expiresAt).getTime() - Date.now()) / 1000),
    );

    return {
      hasActiveOrder: true,
      order: orderDto,
      remainingSeconds,
    };
  }

  /**
   * 5. Cancelación manual de la orden pendiente y liberación inmediata de stock
   */
  async cancelActiveOrder(sessionId: string): Promise<{ success: boolean; message: string }> {
    const cancelled = await this.checkoutSessionService.cancelActiveOrder(sessionId);
    return {
      success: cancelled,
      message: cancelled
        ? 'Orden pendiente cancelada e inventario reservado liberado exitosamente'
        : 'No se encontró orden pendiente activa para cancelar',
    };
  }

  /**
   * Consulta interna de la entidad de orden con todas sus relaciones
   */
  async findOrderEntity(orderNumber: string, accessToken: string): Promise<Order> {
    return this.orderTrackingService.findOrderEntity(orderNumber, accessToken);
  }

  /**
   * 6. Consulta segura de estado y seguimiento de orden para clientes invitados
   */
  async trackOrder(orderNumber: string, accessToken: string): Promise<OrderResponseDto> {
    return this.orderTrackingService.trackOrder(orderNumber, accessToken);
  }

  /**
   * 7. Consulta del estado en tiempo real del pago y orden (fuente de verdad en backend)
   */
  async getPaymentStatus(orderIdOrNumber: string, token?: string) {
    return this.paymentStatusService.getPaymentStatus(orderIdOrNumber, token);
  }

  /**
   * Renderiza la plantilla HTML para seguimiento visual en el navegador
   */
  renderTrackingHtml(order: OrderResponseDto): string {
    return this.orderTrackingService.renderTrackingHtml(order);
  }
}
