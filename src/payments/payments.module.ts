import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Invoice } from '../orders/entities/invoice.entity';
import { Order } from '../orders/entities/order.entity';
import { PaymentsService } from './payments.service';
import { PaymentStatusService } from './services/payment-status.service';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import { PaymentsController } from './payments.controller';
import { WebhooksController } from './webhooks.controller';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';
import { ExternalPaymentGateway } from './gateways/payment-gateway.service';
import { GatewayModule } from '../gateway/gateway.module';
import { OrdersModule } from '../orders/orders.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Invoice, Order]),
    GatewayModule,
    ConfigModule,
    InventoryModule,
    DeliveryModule,
    NotificationsModule,
    SecurityModule,
    forwardRef(() => OrdersModule),
  ],
  controllers: [PaymentsController, WebhooksController],
  providers: [
    PaymentsService,
    PaymentStatusService,
    PaymentReconciliationService,
    {
      provide: PAYMENT_GATEWAY,
      useClass: ExternalPaymentGateway,
    },
  ],
  exports: [
    PaymentsService,
    PaymentStatusService,
    PaymentReconciliationService,
    PAYMENT_GATEWAY,
    TypeOrmModule,
  ],
})
export class PaymentsModule {}
