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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FeeCalculationResponseDto } from './dto/fee-calculation.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly baseFeeInCents: number;
  private readonly deliveryFeeInCents: number;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly productsService: ProductsService,
    private readonly gatewayService: GatewayService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.baseFeeInCents = Number(this.configService.get<number>('BASE_FEE_IN_CENTS', 300000));
    this.deliveryFeeInCents = Number(this.configService.get<number>('DELIVERY_FEE_IN_CENTS', 1000000));
  }

  /**
   * Calcula el resumen de cobro (producto + base fee + delivery fee)
   */
  async calculateFees(productId: string, quantity = 1): Promise<FeeCalculationResponseDto> {
    const product = await this.productsService.findOne(productId);
    const productPriceInCents = Number(product.priceInCents) * quantity;
    const totalAmountInCents = productPriceInCents + this.baseFeeInCents + this.deliveryFeeInCents;

    return {
      productPriceInCents,
      baseFeeInCents: this.baseFeeInCents,
      deliveryFeeInCents: this.deliveryFeeInCents,
      totalAmountInCents,
      currency: 'COP',
    };
  }

  /**
   * Flujo principal de pago:
   * 1. Valida el producto y el stock disponible.
   * 2. Calcula totales.
   * 3. Crea la transacción en estado PENDING con referencia única.
   * 4. Llama a la pasarela de pagos Sandbox.
   * 5. Actualiza el estado según respuesta de la pasarela.
   * 6. Si es APPROVED, descuenta el stock de forma transaccional.
   */
  async processPayment(dto: CreatePaymentDto): Promise<Transaction> {
    const quantity = dto.quantity || 1;
    const product = await this.productsService.findOne(dto.productId);

    if (product.stock < quantity) {
      throw new BadRequestException(
        `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}`,
      );
    }

    const fees = await this.calculateFees(dto.productId, quantity);
    const reference = `TX-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    let transaction = this.transactionRepository.create({
      reference,
      status: TransactionStatus.PENDING,
      productAmountInCents: fees.productPriceInCents,
      baseFeeInCents: fees.baseFeeInCents,
      deliveryFeeInCents: fees.deliveryFeeInCents,
      totalAmountInCents: fees.totalAmountInCents,
      currency: fees.currency,
      customerFullName: dto.customerFullName,
      customerEmail: dto.customerEmail,
      customerPhone: dto.customerPhone,
      deliveryAddress: dto.deliveryAddress,
      deliveryCity: dto.deliveryCity,
      deliveryNotes: dto.deliveryNotes,
      productId: dto.productId,
      quantity,
    });

    transaction = await this.transactionRepository.save(transaction);
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

  async findOne(id: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findOne({
      where: { id },
      relations: { product: true },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }
    return transaction;
  }

  async findByReference(reference: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findOne({
      where: { reference },
      relations: { product: true },
    });
    if (!transaction) {
      throw new NotFoundException(`Transaction with reference ${reference} not found`);
    }
    return transaction;
  }
}
