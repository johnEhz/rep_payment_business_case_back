import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { getTypeOrmConfig } from './config/database.config';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { BrandsModule } from './brands/brands.module';
import { DeliveryModule } from './delivery/delivery.module';
import { InventoryModule } from './inventory/inventory.module';
import { PaymentsModule } from './payments/payments.module';
import { OrdersModule } from './orders/orders.module';
import { TransactionsModule } from './transactions/transactions.module';
import { GatewayModule } from './gateway/gateway.module';
import { SeedModule } from './seeds/seed.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LocationsModule } from './locations/locations.module';
import { TaxesModule } from './taxes/taxes.module';
import { SecurityModule } from './security/security.module';
import { WafMiddleware } from './security/middleware/waf.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getTypeOrmConfig,
    }),
    SecurityModule,
    CategoriesModule,
    BrandsModule,
    TaxesModule,
    ProductsModule,
    DeliveryModule,
    InventoryModule,
    PaymentsModule,
    OrdersModule,
    GatewayModule,
    TransactionsModule,
    SeedModule,
    NotificationsModule,
    LocationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Aplicar WAF de inspección profunda y endurecimiento de cabeceras en todas las rutas
    consumer.apply(WafMiddleware).forRoutes('*');
  }
}
