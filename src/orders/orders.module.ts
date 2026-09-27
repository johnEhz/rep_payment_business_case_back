import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { CheckoutSession } from './entities/checkout-session.entity';
import { Invoice } from './entities/invoice.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrderPreviewService } from './services/order-preview.service';
import { OrderCreationService } from './services/order-creation.service';
import { OrderPaymentService } from './services/order-payment.service';
import { OrderTrackingService } from './services/order-tracking.service';
import { CheckoutSessionService } from './services/checkout-session.service';
import { InventoryModule } from '../inventory/inventory.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LocationsModule } from '../locations/locations.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, CheckoutSession, Invoice]),
    InventoryModule,
    DeliveryModule,
    forwardRef(() => PaymentsModule),
    NotificationsModule,
    LocationsModule,
    ProductsModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrderPreviewService,
    OrderCreationService,
    OrderPaymentService,
    OrderTrackingService,
    CheckoutSessionService,
    OrdersService,
  ],
  exports: [
    OrdersService,
    OrderPreviewService,
    OrderCreationService,
    OrderPaymentService,
    OrderTrackingService,
    CheckoutSessionService,
    TypeOrmModule,
  ],
})
export class OrdersModule {}
