# Payment Business Case - Backend API

Servicio backend para procesamiento de órdenes de compra, control de inventario concurrente, cálculo dinámico de envíos y pagos mediante pasarela de pagos. Desarrollado con NestJS, TypeScript, TypeORM y PostgreSQL.

---

## Características Principales

- **Compra como Invitado (Guest Checkout):** Creación de pedidos sin registro previo, con emisión de `accessToken` criptográfico para seguimiento seguro.
- **Control Concurrente de Inventario:** Reservas de inventario con bloqueo pesimista en base de datos (`pessimistic_write`) con vigencia de 15 minutos.
- **Cotización Dinámica de Envíos:** Cálculo de distancias y tarifas mediante integración con Mapbox y matriz de reglas de despacho.
- **Validación Reactiva de Pagos:** Consulta en tiempo real a la pasarela durante la espera del cliente (`GET /orders/payment-status/:orderNumber`) y cron de conciliación en segundo plano cada minuto.
- **Notificaciones Transaccionales:** Emisión de correos mediante Amazon SES con plantillas oficiales y desglose tributario de IVA (19%).
- **Seguridad:** WAF middleware, limitador de tasa (rate limiting), saneamiento de cabeceras CORS y validación criptográfica de firmas SHA-256 en webhooks.

---

## Endpoints de Producción

- **API Base (CloudFront HTTPS):** `https://d2fwq2zkaxox3s.cloudfront.net/api`
- **Webhook de Pagos:** `https://d2fwq2zkaxox3s.cloudfront.net/webhooks/gateway`
- **Health Check:** `https://d2fwq2zkaxox3s.cloudfront.net/api/health`

---

## Endpoints Principales

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del servicio y uptime |
| `GET` | `/api/products` | Catálogo de productos con filtros de categoría y marca |
| `GET` | `/api/products/:id` | Detalle de un producto por ID o slug |
| `GET` | `/api/categories` | Lista de categorías disponibles |
| `GET` | `/api/brands` | Lista de marcas registradas |
| `POST` | `/api/checkout/preview` | Cotización de carrito, envío y desglose de IVA |
| `POST` | `/api/checkout/order` | Creación de orden como invitado y reserva de stock |
| `POST` | `/api/checkout/pay` | Ejecución de cobro con tarjeta mediante tokenización |
| `GET` | `/api/checkout/active-order` | Consulta de orden activa con transacciones pendientes |
| `POST` | `/api/checkout/cancel-active-order` | Cancelación de orden activa y liberación de reserva |
| `GET` | `/api/orders/payment-status/:orderNumber` | Estado del pago en tiempo real con validación JIT |
| `GET` | `/api/orders/track/:orderNumber` | Seguimiento seguro de orden mediante `token` |
| `POST` | `/webhooks/gateway` | Recepción de eventos asíncronos de la pasarela |

---

## Instalación y Ejecución Local

### Prerrequisitos
- Node.js >= 20
- pnpm >= 9
- PostgreSQL >= 15

### Pasos

1. Clonar el repositorio e ingresar a la carpeta:
```bash
cd rep_payment_business_case_back
pnpm install
```

2. Configurar variables de entorno (`.env`):
```env
PORT=3000
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_case_db
DB_USERNAME=postgres
DB_PASSWORD=tu_password
DB_SYNCHRONIZE=true

FRONTEND_URL=http://localhost:3001
GATEWAY_API_URL=https://api-sandbox.co.uat.wompi.dev/v1
GATEWAY_PUBLIC_KEY=pub_stagtest_...
GATEWAY_PRIVATE_KEY=prv_stagtest_...
GATEWAY_INTEGRITY_SECRET=stagtest_integrity_...
GATEWAY_EVENTS_SECRET=stagtest_events_...

MAPBOX_ACCESS_TOKEN=pk.eyJ1I...
AWS_REGION=us-east-1
SES_SOURCE_EMAIL=dynamitesoftware21@gmail.com
SES_SENDER_EMAIL=dynamitesoftware21@gmail.com
```

3. Iniciar el servicio:
```bash
# Modo desarrollo con recarga en caliente
pnpm run start:dev

# Compilar para producción
pnpm run build

# Ejecutar compilado
pnpm run start:prod
```

4. Subir plantillas a Amazon SES (opcional):
```bash
pnpm run templates:ses
```

---

## Pruebas Automatizadas

```bash
# Pruebas unitarias
pnpm run test

# Pruebas e2e
pnpm run test:e2e

# Cobertura de pruebas
pnpm run test:cov
```

---

## Colección de Postman

La colección actualizada con los endpoints locales y de producción se encuentra en:
- `postman/ecommerce_guest_checkout_collection.json`
- `../postman_collection.json`
