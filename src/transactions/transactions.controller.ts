import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FeeCalculationResponseDto } from './dto/fee-calculation.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  /**
   * Endpoint para calcular el desglose de tarifas dinámicas antes de pagar:
   * GET /transactions/fees?productId=UUID&quantity=1&deliveryAddress=...&deliveryCity=...
   */
  @Get('fees')
  async calculateFees(
    @Query('productId', new ParseUUIDPipe()) productId: string,
    @Query('quantity', new DefaultValuePipe(1), ParseIntPipe) quantity: number,
    @Query('deliveryAddress') deliveryAddress?: string,
    @Query('deliveryCity') deliveryCity?: string,
  ): Promise<FeeCalculationResponseDto> {
    return this.transactionsService.calculateFees(
      productId,
      quantity,
      deliveryAddress,
      deliveryCity,
    );
  }

  /**
   * Endpoint para procesar el pago completo:
   * POST /transactions/checkout
   * 1. Crea transacción en PENDING con desglose dinámico de delivery
   * 2. Llama a la pasarela de pagos
   * 3. Actualiza transacción con resultado
   * 4. Asigna producto y actualiza stock
   */
  @Post('checkout')
  async checkout(@Body() dto: CreatePaymentDto): Promise<TransactionResponseDto> {
    return this.transactionsService.processPayment(dto);
  }

  /**
   * Consulta el estado y detalle de una transacción por ID
   * GET /transactions/:id
   */
  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<TransactionResponseDto> {
    return this.transactionsService.findOne(id);
  }

  /**
   * Consulta una transacción por su referencia única
   * GET /transactions/reference/:reference
   */
  @Get('reference/:reference')
  async findByReference(@Param('reference') reference: string): Promise<TransactionResponseDto> {
    return this.transactionsService.findByReference(reference);
  }
}
