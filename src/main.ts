import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Deshabilitar la firma de Express para evitar fingerprinting del servidor
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // Habilitar CORS con lista blanca de orígenes y cabeceras de seguridad
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Permitir herramientas locales / Postman / Webhooks sin cabecera origin
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Acceso bloqueado por política de CORS: ${origin}`), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders:
      'Content-Type,Accept,Authorization,x-checkout-session-id,Idempotency-Key,x-idempotency-key,x-antibot-token,x-requested-with',
    exposedHeaders:
      'x-checkout-session-id,Idempotency-Key,X-Idempotency-Lookup,X-RateLimit-Limit,X-RateLimit-Remaining,Retry-After',
    credentials: true,
  });

  // Prefijo global de API (excluyendo webhooks para permitir acceso directo de la pasarela)
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'webhooks/gateway', method: RequestMethod.ALL },
      { path: 'webhooks/payment', method: RequestMethod.ALL },
    ],
  });

  // Redirección directa para enlaces de tracking y payment-status sin prefijo /api
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.get('/orders/track/:orderNumber', (req: any, res: any) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const token = req.query?.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
    return res.redirect(`${frontendUrl}/orders/track/${req.params.orderNumber}${token}`);
  });

  expressInstance.get('/orders/:id/payment-status', (req: any, res: any) => {
    const token = req.query?.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
    return res.redirect(`/api/orders/${req.params.id}/payment-status${token}`);
  });

  // Validación global de DTOs con class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Server listening on port ${port} (API base: http://localhost:${port}/api)`);
  logger.log(`Gateway Webhook URL: http://localhost:${port}/webhooks/gateway`);
}
bootstrap();
