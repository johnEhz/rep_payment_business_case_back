# Payment Business Case - Backend API

Servicio backend para procesamiento de órdenes de compra, control concurrente de inventario, cálculo dinámico de envíos y procesamiento de pagos con pasarela de pagos. Desarrollado con NestJS, TypeScript, TypeORM y PostgreSQL.

---

## Flujo Funcional Explicativo (Paso a Paso)

El ciclo de compra implementa un modelo de compra como invitado (Guest Checkout) estructurado en cinco fases continuas:

### 1. Exploracion del Catalogo
El usuario consulta el catalogo de productos categorizados con consulta optimizada de precios e inventario disponible en tiempo real.

### 2. Reserva de Inventario y Creacion de Orden
Al iniciar el proceso de compra, el sistema ejecuta una transaccion relacional con bloqueo pesimista de escritura (`pessimistic_write`) sobre las tablas de inventario en PostgreSQL:
- Se apartan las unidades exactas solicitadas mediante registros en la entidad `StockReservation`.
- Se genera una orden con numero visible de referencia comercial (ej. DYN-10452) en estado `PENDING_PAYMENT`.
- Se asocia un token de acceso criptografico (`accessToken`) unico para la orden, permitiendo al comprador consultar y procesar su orden sin necesidad de crear contraseñas ni registrar cuentas de usuario.
- La reserva de inventario tiene una vigencia estricta de 15 minutos. Si el pago no se completa antes de este plazo, la reserva se libera de forma automatica para que otros usuarios puedan adquirir los articulos.

### 3. Cotizacion de Envio y Liquidacion Tributaria (IVA 19%)
Antes de procesar el pago, el cliente proporciona su direccion y ciudad de despacho:
- El backend geocodifica y calcula la distancia metrica utilizando la integracion con Mapbox y aplica una matriz de tarifas de transporte (costo base fijo mas variable segun distancia y reglas de exoneracion).
- Se aplica el calculo fiscal explicito conforme a la normativa tributaria: separacion de base gravable, liquidacion de IVA al 19% sobre los productos gravados y consolidacion del total general a cobrar expresado en centavos de COP (minor units).

### 4. Tokenizacion y Procesamiento del Cobro
El flujo de pago delega la informacion sensible de la tarjeta de credito o debito directamente a la pasarela mediante tokenizacion segura:
- El comprador acepta los terminos y condiciones legales del comercio (`acceptanceToken`).
- La pasarela retorna un `cardToken` que el frontend envia al backend junto con el numero de cuotas seleccionadas y el `accessToken`.
- El backend valida que la orden no este previamente pagada, cancelada o expirada. En caso de detectar un estado terminal o un pago duplicado, responde con error HTTP 409 (`ORDER_ALREADY_PAID`) evitando dobles cobros en la cuenta del cliente.
- El cobro se procesa ante la pasarela y la transaccion queda registrada en la entidad `Transaction` vinculada a la orden.

### 5. Confirmacion y Emision de Comprobante
El sistema verifica el resultado de la transaccion de forma reactiva (Just-In-Time) y notifica al comprador:
- Si el pago es aprobado (`APPROVED`), la orden transiciona a estado `PAID`, las reservas de inventario se confirman permanentemente y se programa el despacho del pedido.
- Si el pago es rechazado (`DECLINED`), la orden permite reintentar el pago con otro medio de pago mientras permanezca dentro de la ventana de vigencia de 15 minutos.
- Al confirmarse el resultado, el frontend reinicia la sesion de checkout para permitir una navegacion limpia de regreso a la tienda sin bloqueos ni recargas invasivas.

---

## Tareas en Segundo Plano y Crons

El sistema cuenta con tareas programadas de alta confiabilidad que se ejecutan en segundo plano utilizando `@nestjs/schedule`:

### 1. Reconciliador de Pagos (`OrderReconciliationService`)
- **Frecuencia:** Se ejecuta de forma automatica cada 1 minuto (`CronExpression.EVERY_MINUTE`).
- **Proposito:** Identifica todas las transacciones que hayan quedado en estado `PENDING`. Consulta directamente el estado de cada transaccion en la API de la pasarela de pagos.
- **Beneficio Funcional:** Garantiza que los pagos asincronos (como validaciones bancarias demoradas o usuarios que cierran el navegador antes de recibir la confirmacion) se actualicen oportunamente a `APPROVED` o `DECLINED`, asegurando que el cliente reciba su confirmacion sin intervencion manual de soporte.

### 2. Liberador de Reservas Expiradas (`OrderExpirationService`)
- **Frecuencia:** Se ejecuta de forma automatica cada 1 minuto (`CronExpression.EVERY_MINUTE`).
- **Proposito:** Revisa las ordenes en estado `PENDING_PAYMENT` cuya marca de tiempo `expiresAt` haya superado la vigencia de 15 minutos sin haberse registrado un pago exitoso.
- **Accion:** Transiciona las reservas de stock a estado `EXPIRED`, reintegra las unidades disponibles al inventario de productos y marca la orden como `EXPIRED`. Esto previene el acaparamiento de productos y asegura la disponibilidad real del catalogo.

---

## Servicio de Correo Electronico y Plantillas (Amazon SES)

Las notificaciones por correo electronico transaccional son gestionadas a traves de Amazon Simple Email Service (SES):

### 1. Alojamiento de Plantillas
- Las plantillas de correo electronico estan alojadas directamente en el servicio de Amazon SES en la nube de AWS como plantillas de correo administradas (`ses:CreateTemplate` / `ses:UpdateTemplate`).
- Las plantillas renderizan variables dinamicas como numero de pedido, nombre del cliente, lista de articulos, desglose de subtotal, IVA del 19%, costo de despacho y total pagado.

### 2. Plantillas Disponibles
- `OrderCreatedTemplate`: Notificacion de recepcion de orden de compra con enlace de seguimiento y recordatorio de tiempo limite de pago.
- `PaymentApprovedTemplate`: Comprobante detallado de pago exitoso con desglose comercial y confirmacion de envio.
- `PaymentDeclinedTemplate`: Notificacion informativa sobre el rechazo del medio de pago con orientacion para reintento.

### 3. Direccion Remitente
- Todos los correos transaccionales son enviados desde la direccion autorizada y verificada en el servicio: `dynamitesoftware21@gmail.com`.

---

## Arquitectura de Despliegue en AWS con AWS CDK

La infraestructura del proyecto se gestiona integramente como codigo (IaC) mediante AWS CDK v2 en TypeScript. La arquitectura esta compuesta por los siguientes servicios en la nube:

### 1. Amazon ECS (Elastic Container Service) con AWS Fargate
- Aloja el contenedor de la aplicacion backend NestJS en una modalidad Serverless (sin administracion de servidores ni instancias EC2).
- Proporciona escalado automatico, monitoreo continuo de salud mediante sondas HTTP (`/api/health`) y reinicio automatico ante fallos.
- Las tareas se ejecutan en subredes privadas con salida a internet controlada a traves de NAT Gateway para garantizar aislamiento perimetral.

### 2. Application Load Balancer (ALB)
- Distribuye el trafico entrante hacia los contenedores de la aplicacion en el cluster de ECS Fargate.
- Realiza verificaciones de estado periodicas sobre el Target Group y gestiona la desconexion elegante de conexiones existentes durante los despliegues.

### 3. Amazon CloudFront
- Red de distribucion de contenido (CDN) global que actua como punto de entrada unico y seguro para la API backend.
- Proporciona terminacion SSL/TLS con certificados digitales gestionados, compresion automatica de respuestas y mitigacion perimetral de ataques DDoS.

### 4. Amazon RDS PostgreSQL
- Base de datos relacional administrada para almacenar productos, ordenes, items, clientes, transacciones, envios y registros de auditoria.
- Ofrece copias de seguridad continuas, almacenamiento cifrado en reposo y soporte para transacciones con niveles de aislamiento y bloqueos pesimistas de concurrencia.

### 5. Amazon Elastic Container Registry (ECR)
- Registro de contenedores privado y seguro para almacenar y versionar las imagenes Docker del backend compilado.

### 6. AWS Systems Manager Parameter Store (SSM)
- Almacenamiento centralizado y seguro de parametros de configuracion del sistema y secretos operativos (claves de integracion de pasarela, secretos de sesion y credenciales de acceso).

### 7. Amazon Simple Email Service (SES)
- Plataforma de envio de correo transaccional de alta reputacion y entrega garantizada con soporte de plantillas HTML y parametros dinamicos.

### 8. AWS Amplify Hosting
- Plataforma de entrega continua (CI/CD) y alojamiento global en la red de borde (Edge CDN) para la aplicacion web Frontend en React.

---

## Endpoints de la API

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/health` | Estado del servicio y verificacion de uptime |
| GET | `/api/products` | Catalogo de productos con filtros de categoria y marca |
| GET | `/api/products/:id` | Detalle de un producto individual por ID |
| GET | `/api/categories` | Listado de categorias de producto |
| GET | `/api/brands` | Listado de marcas de producto |
| POST | `/api/checkout/preview` | Cotizacion previa de envio, impuestos y subtotal |
| POST | `/api/checkout/order` | Creacion de orden como invitado y reserva de stock |
| POST | `/api/checkout/pay` | Ejecucion de cobro con tarjeta mediante tokenizacion |
| GET | `/api/checkout/active-order` | Consulta de orden activa con transacciones pendientes |
| POST | `/api/checkout/cancel-active-order` | Cancelacion manual de orden activa y liberacion de stock |
| GET | `/api/orders/payment-status/:orderNumber` | Consulta reactiva del estado del pago en tiempo real |
| GET | `/api/orders/track/:orderNumber` | Seguimiento seguro de orden mediante token de acceso |
| POST | `/webhooks/gateway` | Recepcion de webhooks asincronos de la pasarela |

---

## Ejecucion de Pruebas Automatizadas

El proyecto cuenta con suites de pruebas unitarias y de integracion:

```bash
# Ejecutar todas las pruebas del backend
npm test

# Ejecutar pruebas en modo observador
npm run test:watch

# Ejecutar pruebas de cobertura
npm run test:cov
```
