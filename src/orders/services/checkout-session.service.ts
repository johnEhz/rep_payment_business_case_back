import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { CheckoutSession } from '../entities/checkout-session.entity';
import { Order, OrderStatus } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { InventoryService } from '../../inventory/inventory.service';
import { ReservationStatus } from '../../inventory/entities/stock-reservation.entity';
import { Transaction, TransactionStatus } from '../../transactions/entities/transaction.entity';

export const COOKIE_CHECKOUT_SESSION = 'checkout_session_id';
export const HEADER_CHECKOUT_SESSION = 'x-checkout-session-id';

@Injectable()
export class CheckoutSessionService {
  private readonly logger = new Logger(CheckoutSessionService.name);

  constructor(
    @InjectRepository(CheckoutSession)
    private readonly sessionRepository: Repository<CheckoutSession>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * Extrae el token de sesión de la cookie HttpOnly o de la cabecera x-checkout-session-id
   */
  extractToken(req: any): string | null {
    if (!req) return null;

    // 1. Cabecera personalizada
    const headerVal = req.headers?.[HEADER_CHECKOUT_SESSION];
    if (headerVal && typeof headerVal === 'string' && headerVal.trim().length > 0) {
      return headerVal.trim();
    }

    // 2. Cookie HttpOnly nativa
    const cookieHeader = req.headers?.cookie;
    if (cookieHeader && typeof cookieHeader === 'string') {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_CHECKOUT_SESSION}=([^;]+)`));
      if (match) {
        return decodeURIComponent(match[1].trim());
      }
    }

    return null;
  }

  /**
   * Configura la cookie segura y cabecera en la respuesta HTTP
   */
  applySessionToResponse(res: any, token: string): void {
    if (!res) return;

    try {
      if (typeof res.cookie === 'function') {
        res.cookie(COOKIE_CHECKOUT_SESSION, token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días de persistencia
          path: '/',
        });
      }

      if (typeof res.setHeader === 'function') {
        res.setHeader(HEADER_CHECKOUT_SESSION, token);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to set session cookie/header: ${err?.message || err}`);
    }
  }

  /**
   * Obtiene la sesión de checkout activa o crea una nueva criptográficamente segura
   */
  async getOrCreateSession(req?: any, res?: any): Promise<CheckoutSession> {
    const existingToken = this.extractToken(req);
    const now = new Date();

    if (existingToken) {
      const session = await this.sessionRepository.findOne({
        where: { token: existingToken },
      });

      if (session && session.expiresAt > now) {
        this.applySessionToResponse(res, session.token);
        return session;
      }
    }

    // Generar nueva sesión criptográfica
    const token = `cs_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newSession = this.sessionRepository.create({
      token,
      expiresAt,
      cartSnapshot: null,
    });

    const savedSession = await this.sessionRepository.save(newSession);
    this.logger.log(`Created new CheckoutSession: ${savedSession.id} (${token.substring(0, 10)}...)`);

    this.applySessionToResponse(res, savedSession.token);
    return savedSession;
  }

  /**
   * Busca la orden PENDING_PAYMENT vigente asociada a la sesión de checkout
   */
  async findActivePendingOrder(sessionId: string): Promise<Order | null> {
    const now = new Date();

    const order = await this.orderRepository.findOne({
      where: {
        checkoutSessionId: sessionId,
        status: OrderStatus.PENDING_PAYMENT,
      },
      relations: {
        items: true,
        delivery: true,
        stockReservations: true,
      },
      order: { createdAt: 'DESC' },
    });

    if (!order) {
      return null;
    }

    // Si la orden ya expiró, actualizar su estado y liberar reservas
    if (now > new Date(order.expiresAt)) {
      this.logger.log(`Order ${order.orderNumber} in session ${sessionId} is expired. Releasing stock...`);
      order.status = OrderStatus.EXPIRED;
      await this.orderRepository.save(order);
      await this.inventoryService.releaseReservations(
        this.orderRepository.manager,
        order.id,
        ReservationStatus.EXPIRED,
      );
      return null;
    }

    return order;
  }

  /**
   * Compara si dos listas de items (orden existente vs carrito actual) son exactamente idénticas
   */
  areItemsIdentical(
    existingItems: OrderItem[],
    requestedItems: { productId: string; quantity: number }[],
  ): boolean {
    if (!existingItems || !requestedItems) return false;
    if (existingItems.length !== requestedItems.length) return false;

    for (const reqItem of requestedItems) {
      const match = existingItems.find(
        (i) => i.productId === reqItem.productId && Number(i.quantity) === Number(reqItem.quantity),
      );
      if (!match) return false;
    }

    return true;
  }

  async hasPendingTransaction(orderId: string): Promise<boolean> {
    const pendingTx = await this.orderRepository.manager.getRepository(Transaction).findOne({
      where: {
        orderId,
        status: TransactionStatus.PENDING,
      },
    });
    return Boolean(pendingTx);
  }

  async cancelActiveOrder(sessionId: string): Promise<boolean> {
    const activeOrder = await this.findActivePendingOrder(sessionId);
    if (!activeOrder) return false;

    activeOrder.status = OrderStatus.CANCELLED;
    await this.orderRepository.save(activeOrder);

    await this.inventoryService.releaseReservations(
      this.orderRepository.manager,
      activeOrder.id,
      ReservationStatus.RELEASED,
    );

    this.logger.log(`Active pending order ${activeOrder.orderNumber} cancelled for session ${sessionId}.`);
    return true;
  }
}
