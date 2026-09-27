import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutPreviewDto } from './dto/checkout-preview.dto';
import { CreateGuestOrderDto } from './dto/create-guest-order.dto';
import { PayOrderDto } from './dto/pay-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { RateLimit, RateLimiterGuard } from '../security/guards/rate-limiter.guard';
import { RateLimitTier } from '../security/services/rate-limiter.service';
import { AntiBotGuard } from '../security/guards/anti-bot.guard';
import { IdempotencyInterceptor } from '../security/interceptors/idempotency.interceptor';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * 1. Cotización previa del carrito y delivery dinámico con sesión segura
   * POST /checkout/preview
   */
  @Post('checkout/preview')
  @UseGuards(RateLimiterGuard)
  @RateLimit(RateLimitTier.CHECKOUT_PREVIEW)
  async previewCheckout(
    @Body() dto: CheckoutPreviewDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    await this.ordersService.getOrCreateSession(req, res);
    return this.ordersService.previewCheckout(dto);
  }

  /**
   * 2. Creación o reutilización de orden de compra con reserva de inventario
   * Protegido por Rate Limiting, Anti-Bot y Bloqueo de Idempotencia
   * POST /checkout/order
   */
  @Post('checkout/order')
  @UseGuards(RateLimiterGuard, AntiBotGuard)
  @RateLimit(RateLimitTier.CHECKOUT_ORDER)
  @UseInterceptors(IdempotencyInterceptor)
  async createGuestOrder(
    @Body() dto: CreateGuestOrderDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ): Promise<OrderResponseDto> {
    const session = await this.ordersService.getOrCreateSession(req, res);
    return this.ordersService.createGuestOrder(dto, session);
  }

  /**
   * 3. Consulta de orden pendiente activa y vigente para la sesión de checkout actual
   * GET /checkout/active-order
   */
  @Get('checkout/active-order')
  @UseGuards(RateLimiterGuard)
  @RateLimit(RateLimitTier.CHECKOUT_PREVIEW)
  async getActivePendingOrder(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const session = await this.ordersService.getOrCreateSession(req, res);
    return this.ordersService.getActivePendingOrder(session.id);
  }

  /**
   * 4. Cancelación manual de la orden pendiente y liberación inmediata de stock reservado
   * POST /checkout/cancel-active-order
   */
  @Post('checkout/cancel-active-order')
  @UseGuards(RateLimiterGuard)
  @RateLimit(RateLimitTier.CHECKOUT_PREVIEW)
  async cancelActiveOrder(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const session = await this.ordersService.getOrCreateSession(req, res);
    return this.ordersService.cancelActiveOrder(session.id);
  }

  /**
   * 5. Procesar el pago de la orden creada
   * Protegido por Rate Limiting estricto, Anti-Bot y Bloqueo de Idempotencia contra doble cobro
   * POST /checkout/pay
   */
  @Post('checkout/pay')
  @UseGuards(RateLimiterGuard, AntiBotGuard)
  @RateLimit(RateLimitTier.CHECKOUT_PAY)
  @UseInterceptors(IdempotencyInterceptor)
  async payOrder(
    @Body() dto: PayOrderDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    await this.ordersService.getOrCreateSession(req, res);
    return this.ordersService.payOrder(dto);
  }

  /**
   * 6. Seguimiento seguro del pedido para clientes invitados
   * GET /orders/track/:orderNumber?token=...
   * GET /api/orders/track/:orderNumber?token=...
   */
  @Get('orders/track/:orderNumber')
  async trackOrderByNumber(
    @Param('orderNumber') orderNumber: string,
    @Query('token') token: string,
    @Query('format') format: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    if (!token) {
      throw new UnauthorizedException('Access token is required to track this order');
    }
    const orderDto = await this.ordersService.trackOrder(orderNumber, token);

    const acceptsHtml = req.headers?.accept && req.headers.accept.includes('text/html');
    if (acceptsHtml && format !== 'json') {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
      return res.redirect(`${frontendUrl}/orders/track/${orderNumber}?token=${token}`);
    }

    return res.json(orderDto);
  }

  /**
   * 7. Consulta en tiempo real del estado de pago y orden (fuente de verdad en backend)
   * GET /orders/:id/payment-status?token=...
   * GET /api/orders/:id/payment-status?token=...
   */
  @Get('orders/:id/payment-status')
  async getPaymentStatus(
    @Param('id') id: string,
    @Query('token') token?: string,
  ) {
    return this.ordersService.getPaymentStatus(id, token);
  }
}
