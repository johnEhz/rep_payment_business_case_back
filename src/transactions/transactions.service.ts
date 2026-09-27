import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Transaction, TransactionStatus } from './entities/transaction.entity';
import { ProductsService } from '../products/products.service';
import { GatewayService } from '../gateway/gateway.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FeeCalculationResponseDto } from './dto/fee-calculation.dto';
import {
  TransactionResponseDto,
  toTransactionResponseDto,
} from './dto/transaction-response.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly baseFeeInCents: number;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly productsService: ProductsService,
    private readonly gatewayService: GatewayService,
    private readonly deliveryService: DeliveryService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.baseFeeInCents = Number(this.configService.get<number>('BASE_FEE_IN_CENTS', 300000));
  }

  /**
   * Calcula el resumen de cobro dinámico:
   * Producto + Tarifa Base + Delivery Dinámico (distancia con Mapbox + valor compra + descuento)
   */
  async calculateFees(
    productId: string,
    quantity = 1,
    deliveryAddress?: string,
    deliveryCity = 'Medellín',
  ): Promise<FeeCalculationResponseDto> {
    const product = await this.productsService.findOne(productId);
    const productPriceInCents = Number(product.priceInCents) * quantity;

    // Cálculo dinámico de delivery mediante Mapbox y reglas de negocio
    const deliveryCalc = await this.deliveryService.calculateDeliveryFee(
      productPriceInCents,
      deliveryAddress,
      deliveryCity,
    );

    const totalAmountInCents =
      productPriceInCents + this.baseFeeInCents + deliveryCalc.finalDeliveryFeeInCents;

    return {
      productPriceInCents,
      baseFeeInCents: this.baseFeeInCents,
      deliveryFeeInCents: deliveryCalc.finalDeliveryFeeInCents,
      deliveryDistanceKm: deliveryCalc.distanceKm,
      deliveryDistanceCostInCents: deliveryCalc.distanceCostInCents,
      deliveryValueCostInCents: deliveryCalc.valueCostInCents,
      deliveryDiscountInCents: deliveryCalc.discountInCents,
      deliveryAppliedRules: deliveryCalc.appliedRules,
      totalAmountInCents,
      currency: 'COP',
    };
  }

  /**
   * Flujo principal de pago:
   * 1. Valida el producto y el stock disponible.
   * 2. Calcula totales y delivery dinámico según dirección de entrega.
   * 3. Crea la transacción en estado PENDING con referencia única y desglose de delivery.
   * 4. Llama a la pasarela de pagos Sandbox.
   * 5. Actualiza el estado según respuesta de la pasarela.
   * 6. Si es APPROVED, descuenta el stock de forma transaccional.
   */
  async processPayment(dto: CreatePaymentDto): Promise<TransactionResponseDto> {
    const quantity = dto.quantity || 1;
    const product = await this.productsService.findOne(dto.productId);

    if (product.stock < quantity) {
      throw new BadRequestException(
        `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}`,
      );
    }

    const fees = await this.calculateFees(
      dto.productId,
      quantity,
      dto.deliveryAddress,
      dto.deliveryCity,
    );
    const reference = `TX-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const txData: Partial<Transaction> = {
      reference,
      amountInCents: fees.totalAmountInCents,
      currency: fees.currency,
      paymentMethod: 'CARD',
      installments: dto.installments || 1,
      status: TransactionStatus.PENDING,
    };
    let transaction: Transaction = await this.transactionRepository.save(
      this.transactionRepository.create(txData),
    );
    this.logger.log(`Created transaction ${transaction.id} with reference ${reference} in PENDING status`);

    try {
      const gatewayResult = await this.gatewayService.createTransaction({
        acceptanceToken: dto.acceptanceToken,
        amountInCents: fees.totalAmountInCents,
        currency: fees.currency,
        customerEmail: dto.customerEmail,
        reference,
        cardToken: dto.cardToken,
        installments: dto.installments,
      });

      this.logger.log(`Gateway response for reference ${reference}: ${JSON.stringify(gatewayResult)}`);

      const gatewayStatus = gatewayResult.status;
      transaction.gatewayTransactionId = gatewayResult.id || null;
      transaction.statusMessage = gatewayResult.status_message || gatewayResult.error || null;

      if (gatewayStatus === 'APPROVED') {
        transaction.status = TransactionStatus.APPROVED;

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
          await this.productsService.decrementStockTransactional(
            queryRunner.manager,
            dto.productId,
            quantity,
          );
          
          transaction = await queryRunner.manager.save(Transaction, transaction);
          await queryRunner.commitTransaction();
          this.logger.log(`Transaction ${transaction.id} APPROVED and stock decremented successfully.`);
        } catch (txError) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Failed to decrement stock for transaction ${transaction.id}`, txError);
          transaction.status = TransactionStatus.ERROR;
          transaction.statusMessage = 'Payment succeeded in gateway but stock assignment failed.';
          await this.transactionRepository.save(transaction);
        } finally {
          await queryRunner.release();
        }
      } else if (gatewayStatus === 'DECLINED') {
        transaction.status = TransactionStatus.DECLINED;
        await this.transactionRepository.save(transaction);
      } else if (gatewayStatus === 'VOIDED') {
        transaction.status = TransactionStatus.VOIDED;
        await this.transactionRepository.save(transaction);
      } else {
        transaction.status = TransactionStatus.ERROR;
        await this.transactionRepository.save(transaction);
      }
    } catch (error: any) {
      this.logger.error(`Unexpected error processing payment for transaction ${transaction.id}`, error);
      transaction.status = TransactionStatus.ERROR;
      transaction.statusMessage = error?.message || 'Payment processing error';
      await this.transactionRepository.save(transaction);
    }

    return this.findOne(transaction.id);
  }

  async findEntityById(id: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findOne({
      where: { id },
      relations: { order: { items: true, delivery: true } },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }
    return transaction;
  }

  async findOne(id: string): Promise<TransactionResponseDto> {
    const transaction = await this.findEntityById(id);
    return toTransactionResponseDto(transaction);
  }

  async findByReference(reference: string): Promise<TransactionResponseDto> {
    const transaction = await this.transactionRepository.findOne({
      where: { reference },
      relations: { order: { items: true, delivery: true } },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with reference ${reference} not found`);
    }
    return toTransactionResponseDto(transaction);
  }

  async findByOrderId(orderId: string): Promise<TransactionResponseDto | null> {
    const transaction = await this.transactionRepository.findOne({
      where: { orderId },
      relations: { order: { items: true, delivery: true } },
      order: { createdAt: 'DESC' },
    });
    if (!transaction) {
      return null;
    }
    return toTransactionResponseDto(transaction);
  }
}
