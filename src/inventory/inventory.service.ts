import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StockReservation, ReservationStatus } from './entities/stock-reservation.entity';
import { Product } from '../products/entities/product.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Transaction, TransactionStatus } from '../transactions/entities/transaction.entity';

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(StockReservation)
    private readonly reservationRepository: Repository<StockReservation>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    this.logger.log('Inventory cleanup cron job active: running EVERY_MINUTE to release expired reservations.');
  }

  /**
   * Obtiene el stock disponible real deduciendo reservas activas vigentes
   */
  async getAvailableStock(productId: string): Promise<{ product: Product; availableStock: number; reservedStock: number }> {
    const product = await this.productRepository.findOne({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const activeReserved = await this.dataSource
      .getRepository(StockReservation)
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.quantity), 0)', 'total')
      .where('r.productId = :productId', { productId })
      .andWhere('r.status = :status', { status: ReservationStatus.ACTIVE })
      .andWhere('r.expiresAt > :now', { now: new Date() })
      .getRawOne();

    const reservedStock = Number(activeReserved?.total || 0);
    const availableStock = Math.max(0, product.stock - reservedStock);

    return { product, availableStock, reservedStock };
  }

  /**
   * Valida reactivamente el stock disponible para un lote de items en el carrito o checkout
   */
  async validateCartStock(items: { productId: string; quantity: number }[]) {
    const validatedItems: {
      product: Product;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
      availableStock: number;
    }[] = [];

    for (const item of items) {
      const { product, availableStock } = await this.getAvailableStock(item.productId);

      if (availableStock < item.quantity) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INSUFFICIENT_STOCK',
          message: `Stock insuficiente para "${product.name}". Disponibles: ${availableStock}, solicitadas: ${item.quantity}`,
          productId: item.productId,
          productName: product.name,
          availableStock,
          requestedQuantity: item.quantity,
        });
      }

      const unitPrice = Number(product.priceInCents);
      const totalAmount = unitPrice * item.quantity;

      validatedItems.push({
        product,
        quantity: item.quantity,
        unitPrice,
        totalAmount,
        availableStock,
      });
    }

    return validatedItems;
  }

  /**
   * Reserva temporalmente el inventario de manera atómica con bloqueo pesimista
   */
  async reserveStock(
    manager: EntityManager,
    orderId: string,
    items: { productId: string; quantity: number }[],
    expiresAt: Date,
  ): Promise<StockReservation[]> {
    const reservations: StockReservation[] = [];

    for (const item of items) {
      // Bloqueo pesimista de escritura exclusivo sobre la fila del producto (sin joins para PostgreSQL)
      const product = await manager
        .createQueryBuilder(Product, 'p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: item.productId })
        .getOne();

      if (!product) {
        throw new NotFoundException(`Product with ID ${item.productId} not found`);
      }

      // Calcular stock comprometido en reservas activas y vigentes
      const activeReservations = await manager
        .createQueryBuilder(StockReservation, 'r')
        .where('r.productId = :productId', { productId: item.productId })
        .andWhere('r.status = :status', { status: ReservationStatus.ACTIVE })
        .andWhere('r.expiresAt > :now', { now: new Date() })
        .getMany();

      const totalActiveReserved = activeReservations.reduce((sum, r) => sum + r.quantity, 0);
      const availableStock = product.stock - totalActiveReserved;

      if (availableStock < item.quantity) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'INSUFFICIENT_STOCK',
          message: `Stock insuficiente para "${product.name}". Disponibles: ${availableStock}, solicitadas: ${item.quantity}`,
          productId: item.productId,
          productName: product.name,
          availableStock,
          requestedQuantity: item.quantity,
        });
      }

      const reservation = manager.create(StockReservation, {
        orderId,
        productId: item.productId,
        quantity: item.quantity,
        status: ReservationStatus.ACTIVE,
        expiresAt,
      });

      const savedReservation = await manager.save(StockReservation, reservation);
      reservations.push(savedReservation);
    }

    this.logger.log(`Reserved ${reservations.length} items for order ${orderId} until ${expiresAt.toISOString()}`);
    return reservations;
  }

  /**
   * Confirma definitivamente las reservas y descuenta físicamente el stock del producto
   */
  async confirmReservations(manager: EntityManager, orderId: string): Promise<void> {
    const reservations = await manager.find(StockReservation, {
      where: { orderId, status: ReservationStatus.ACTIVE },
    });

    const now = new Date();

    for (const reservation of reservations) {
      const product = await manager
        .createQueryBuilder(Product, 'p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: reservation.productId })
        .getOne();

      if (product) {
        product.stock -= reservation.quantity;
        await manager.save(Product, product);
      }

      reservation.status = ReservationStatus.CONFIRMED;
      reservation.confirmedAt = now;
      await manager.save(StockReservation, reservation);
    }

    this.logger.log(`Confirmed ${reservations.length} stock reservations for paid order ${orderId}`);
  }

  /**
   * Libera las reservas activas devolviendo la disponibilidad al catálogo
   */
  async releaseReservations(
    manager: EntityManager,
    orderId: string,
    reason: ReservationStatus.RELEASED | ReservationStatus.EXPIRED = ReservationStatus.RELEASED,
  ): Promise<void> {
    const reservations = await manager.find(StockReservation, {
      where: { orderId, status: ReservationStatus.ACTIVE },
    });

    const now = new Date();
    for (const reservation of reservations) {
      reservation.status = reason;
      reservation.releasedAt = now;
      await manager.save(StockReservation, reservation);
    }

    this.logger.log(`Released ${reservations.length} reservations for order ${orderId} with status ${reason}`);
  }

  /**
   * Tarea periódica de limpieza y expiración de órdenes pendientes e inventario
   * Se ejecuta automáticamente cada minuto
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredReservations(): Promise<void> {
    const now = new Date();

    const expiredOrders = await this.orderRepository.find({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt: LessThan(now),
      },
    });

    if (expiredOrders.length === 0) {
      return;
    }

    this.logger.log(`Found ${expiredOrders.length} expired orders. Releasing inventory...`);

    for (const order of expiredOrders) {
      // 1. Si la orden tiene una transacción PENDING en curso con la pasarela, no cancelarla
      const hasPendingTx = await this.dataSource.getRepository(Transaction).findOne({
        where: { orderId: order.id, status: TransactionStatus.PENDING },
      });

      if (hasPendingTx) {
        this.logger.log(
          `Order ${order.orderNumber} reached expiration time but has an active PENDING payment transaction (${hasPendingTx.reference}). Skipping expiration to allow gateway confirmation.`,
        );
        continue;
      }

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        order.status = OrderStatus.EXPIRED;
        await queryRunner.manager.save(Order, order);
        await this.releaseReservations(queryRunner.manager, order.id, ReservationStatus.EXPIRED);
        await queryRunner.commitTransaction();

        this.logger.log(`Order ${order.orderNumber} (${order.id}) transitioned to EXPIRED and reservations released.`);
      } catch (err: any) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Failed to expire order ${order.id}: ${err?.message || err}`);
      } finally {
        await queryRunner.release();
      }
    }
  }
}
