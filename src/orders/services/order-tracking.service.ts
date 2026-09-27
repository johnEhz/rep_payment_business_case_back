import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus } from '../entities/order.entity';
import {
  OrderResponseDto,
  toOrderResponseDto,
} from '../dto/order-response.dto';

@Injectable()
export class OrderTrackingService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  /**
   * Consulta interna de la entidad de orden con todas sus relaciones
   */
  async findOrderEntity(orderNumber: string, accessToken: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { orderNumber },
      relations: {
        items: {
          product: true,
        },
        transactions: true,
        delivery: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with number "${orderNumber}" not found`);
    }

    if (order.accessToken !== accessToken) {
      throw new UnauthorizedException('Invalid access token for this order');
    }

    return order;
  }

  /**
   * Consulta segura de estado y seguimiento de orden para clientes invitados
   */
  async trackOrder(orderNumber: string, accessToken: string): Promise<OrderResponseDto> {
    const order = await this.findOrderEntity(orderNumber, accessToken);
    return toOrderResponseDto(order);
  }

  /**
   * Renderiza una página HTML completa, responsiva y formal para seguimiento de pedidos
   * sin requerir login por parte del usuario invitado.
   */
  renderTrackingHtml(order: OrderResponseDto): string {
    const formatCOP = (centsOrAmount: number) => {
      // Si el monto viene en centavos (ej. > 100000), dividir entre 100
      const amountInPesos = centsOrAmount >= 100000 ? centsOrAmount / 100 : centsOrAmount;
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(amountInPesos);
    };

    const formatDate = (date?: Date | string | null) => {
      if (!date) return 'Pendiente';
      const d = new Date(date);
      return d.toLocaleString('es-CO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    // Determinación del estado visual del progreso
    let statusLabel = 'Pendiente de Pago';
    let statusBg = '#fef3c7';
    let statusColor = '#92400e';
    let step = 1;

    switch (order.status) {
      case OrderStatus.PAID:
        statusLabel = 'Pago Confirmado / En Preparación';
        statusBg = '#dbeafe';
        statusColor = '#1e40af';
        step = 2;
        break;
      case OrderStatus.DELIVERED:
        statusLabel = 'Pedido Entregado';
        statusBg = '#dcfce7';
        statusColor = '#166534';
        step = 4;
        break;
      case OrderStatus.CANCELLED:
        statusLabel = 'Pedido Cancelado';
        statusBg = '#fee2e2';
        statusColor = '#991b1b';
        step = 0;
        break;
      case OrderStatus.EXPIRED:
        statusLabel = 'Plazo de Pago Expirado';
        statusBg = '#f3f4f6';
        statusColor = '#4b5563';
        step = 0;
        break;
      default:
        statusLabel = 'Pendiente de Pago';
        statusBg = '#fef3c7';
        statusColor = '#92400e';
        step = 1;
    }

    const itemsRows = (order.items || [])
      .map((it) => {
        const unitFormatted = formatCOP(it.unitPrice);
        const totalFormatted = formatCOP(it.totalAmount);
        const imgHtml = it.imageUrl
          ? `<img src="${it.imageUrl}" alt="${it.productName}" class="item-img" />`
          : `<div class="item-placeholder">${it.productName.slice(0, 2).toUpperCase()}</div>`;

        return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #edf2f7;">
            <div style="display: flex; align-items: center; gap: 12px;">
              ${imgHtml}
              <div>
                <strong style="color: #1a202c; font-size: 14px;">${it.productName}</strong>
              </div>
            </div>
          </td>
          <td style="padding: 12px 16px; text-align: center; border-bottom: 1px solid #edf2f7; font-size: 14px; color: #4a5568;">
            ${it.quantity}
          </td>
          <td style="padding: 12px 16px; text-align: right; border-bottom: 1px solid #edf2f7; font-size: 14px; color: #4a5568; font-family: monospace;">
            ${unitFormatted}
          </td>
          <td style="padding: 12px 16px; text-align: right; border-bottom: 1px solid #edf2f7; font-size: 14px; font-weight: 700; color: #1a202c; font-family: monospace;">
            ${totalFormatted}
          </td>
        </tr>`;
      })
      .join('');

    const subtotalFormatted = formatCOP(order.subtotalAmount);
    const taxFormatted = formatCOP(order.taxAmount || 0);
    const feeFormatted = formatCOP(order.deliveryFeeAmount || 0);
    const totalFormatted = formatCOP(order.totalAmount);

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Seguimiento de Orden - ${order.orderNumber}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f7fafc;
      color: #2d3748;
      line-height: 1.5;
      padding-bottom: 40px;
    }
    .header {
      background-color: #1a365d;
      color: #ffffff;
      padding: 18px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #2b6cb0;
    }
    .header-title { font-size: 18px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
    .header-help { font-size: 13px; color: #cbd5e0; }
    .container {
      max-width: 820px;
      margin: 32px auto;
      padding: 0 16px;
    }
    .card {
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .order-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-bottom: 20px;
      border-bottom: 1px solid #edf2f7;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    /* Timeline */
    .timeline {
      display: flex;
      justify-content: space-between;
      margin: 30px 0 20px;
      position: relative;
    }
    .timeline::before {
      content: '';
      position: absolute;
      top: 18px;
      left: 30px;
      right: 30px;
      height: 4px;
      background: #e2e8f0;
      z-index: 1;
    }
    .timeline-progress {
      position: absolute;
      top: 18px;
      left: 30px;
      height: 4px;
      background: #2563eb;
      z-index: 1;
      transition: width 0.3s ease;
      width: ${step >= 4 ? '100%' : step === 3 ? '66%' : step === 2 ? '33%' : '0%'};
    }
    .timeline-step {
      position: relative;
      z-index: 2;
      text-align: center;
      flex: 1;
    }
    .timeline-circle {
      width: 36px;
      height: 36px;
      margin: 0 auto 8px;
      border-radius: 50%;
      background: #ffffff;
      border: 3px solid #cbd5e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 700;
      color: #718096;
    }
    .step-active .timeline-circle {
      border-color: #2563eb;
      background: #2563eb;
      color: #ffffff;
    }
    .step-completed .timeline-circle {
      border-color: #16a34a;
      background: #16a34a;
      color: #ffffff;
    }
    .timeline-label {
      font-size: 12px;
      font-weight: 600;
      color: #4a5568;
    }
    /* Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .info-box {
      background: #f8fafc;
      border: 1px solid #edf2f7;
      border-radius: 8px;
      padding: 16px;
    }
    .info-box h3 {
      font-size: 12px;
      font-weight: 700;
      color: #2b6cb0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #718096; }
    .info-val { font-weight: 600; color: #1a202c; text-align: right; }
    /* Table */
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th {
      background: #f8fafc;
      padding: 10px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 700;
      color: #4a5568;
      text-transform: uppercase;
      border-bottom: 2px solid #e2e8f0;
    }
    .item-img {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid #e2e8f0;
    }
    .item-placeholder {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      background: #edf2f7;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: #718096;
    }
    .totals-box {
      max-width: 340px;
      margin-left: auto;
      margin-top: 16px;
      padding: 16px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #edf2f7;
    }
    .btn {
      display: inline-block;
      background-color: #2563eb;
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 700;
      text-decoration: none;
      font-size: 14px;
      border: none;
      cursor: pointer;
      transition: background-color 0.15s;
    }
    .btn:hover { background-color: #1d4ed8; }
    .btn-secondary {
      background-color: #ffffff;
      color: #4a5568;
      border: 1px solid #cbd5e0;
      margin-right: 12px;
    }
    .btn-secondary:hover { background-color: #f7fafc; }
    @media print {
      body { background: white; padding: 0; }
      .header, .actions-bar { display: none; }
      .container { max-width: 100%; margin: 0; padding: 0; }
      .card { border: none; box-shadow: none; padding: 0; margin-bottom: 16px; }
    }
  </style>
</head>
<body>

  <header class="header">
    <div class="header-title">Tienda Virtual · Estado de Entrega</div>
    <div class="header-help">Soporte: soporte@tiendavirtual.com</div>
  </header>

  <main class="container">
    <div class="card">
      <div class="order-header">
        <div>
          <span style="font-size: 12px; color: #718096; text-transform: uppercase; font-weight: 600;">Seguimiento en Vivo</span>
          <h1 style="font-size: 24px; font-weight: 800; color: #1a202c; font-family: monospace;">#${order.orderNumber}</h1>
          <p style="font-size: 13px; color: #718096; margin-top: 4px;">Fecha de Registro: ${formatDate(order.createdAt)}</p>
        </div>
        <div>
          <span class="badge" style="background-color: ${statusBg}; color: ${statusColor};">
            ${statusLabel}
          </span>
        </div>
      </div>

      <!-- Stepper Timeline -->
      <div class="timeline">
        <div class="timeline-progress"></div>
        <div class="timeline-step ${step >= 1 ? (step > 1 ? 'step-completed' : 'step-active') : ''}">
          <div class="timeline-circle">${step > 1 ? '✓' : '1'}</div>
          <div class="timeline-label">Pedido Registrado</div>
        </div>
        <div class="timeline-step ${step >= 2 ? (step > 2 ? 'step-completed' : 'step-active') : ''}">
          <div class="timeline-circle">${step > 2 ? '✓' : '2'}</div>
          <div class="timeline-label">Pago Confirmado</div>
        </div>
        <div class="timeline-step ${step >= 3 ? (step > 3 ? 'step-completed' : 'step-active') : ''}">
          <div class="timeline-circle">${step > 3 ? '✓' : '3'}</div>
          <div class="timeline-label">En Despacho</div>
        </div>
        <div class="timeline-step ${step >= 4 ? 'step-completed' : ''}">
          <div class="timeline-circle">${step >= 4 ? '✓' : '4'}</div>
          <div class="timeline-label">Entregado</div>
        </div>
      </div>

      <!-- Delivery / Payment Notice -->
      ${
        order.deliveredAt || order.paidAt
          ? `<div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; font-size: 13px; color: #166534;">
              <strong>Estado de Entrega:</strong> ${
                order.deliveredAt
                  ? `Paquete entregado con éxito el ${formatDate(order.deliveredAt)} en la dirección indicada.`
                  : `Pago verificado con éxito el ${formatDate(order.paidAt)}. Tu orden se encuentra lista y programada para entrega.`
              }
             </div>`
          : ''
      }

      <!-- Grid info -->
      <div class="grid">
        <div class="info-box">
          <h3>Datos del Comprador y Envío</h3>
          <div class="info-row">
            <span class="info-label">Destinatario:</span>
            <span class="info-val">${order.customerName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Email:</span>
            <span class="info-val">${order.customerEmail}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Teléfono:</span>
            <span class="info-val">${order.customerPhone || 'N/A'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Dirección:</span>
            <span class="info-val">${order.deliveryAddress}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Ciudad / Depto:</span>
            <span class="info-val">${order.deliveryCity}, ${order.deliveryDepartment || 'Antioquia'}</span>
          </div>
        </div>

        <div class="info-box">
          <h3>Detalles de la Transacción</h3>
          <div class="info-row">
            <span class="info-label">Referencia de Pago:</span>
            <span class="info-val" style="font-family: monospace;">${order.transaction?.reference || order.orderNumber}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Método:</span>
            <span class="info-val">${order.transaction?.paymentMethod || 'Tarjeta de Crédito / Débito'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Cuotas Diferidas:</span>
            <span class="info-val">${order.transaction?.installments ? `${order.transaction.installments} cuota(s)` : '1 cuota'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Moneda:</span>
            <span class="info-val">${order.currency || 'COP'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Fecha de Pago:</span>
            <span class="info-val">${formatDate(order.paidAt)}</span>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <div style="margin-top: 24px;">
        <h3 style="font-size: 14px; font-weight: 700; color: #1a202c; text-transform: uppercase; margin-bottom: 8px;">
          Artículos en el Pedido
        </h3>
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th style="text-align: center;">Cantidad</th>
              <th style="text-align: right;">Precio Unitario</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
      </div>

      <!-- Financial Totals -->
      <div class="totals-box">
        <div class="info-row">
          <span class="info-label">Subtotal:</span>
          <span class="info-val" style="font-family: monospace;">${subtotalFormatted}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Envío a Domicilio:</span>
          <span class="info-val" style="font-family: monospace; color: #16a34a;">${order.deliveryFeeAmount === 0 ? 'Gratis' : feeFormatted}</span>
        </div>
        <div class="info-row">
          <span class="info-label">IVA (19%):</span>
          <span class="info-val" style="font-family: monospace;">${taxFormatted}</span>
        </div>
        <div class="info-row" style="border-top: 2px solid #e2e8f0; padding-top: 8px; margin-top: 8px;">
          <span style="font-weight: 700; font-size: 15px; color: #1a202c;">Total Pagado:</span>
          <span style="font-weight: 800; font-size: 16px; color: #2563eb; font-family: monospace;">${totalFormatted}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="actions-bar" style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #edf2f7;">
        <button onclick="window.print()" class="btn btn-secondary">Imprimir Comprobante</button>
        <a href="http://localhost:3001/" class="btn">Volver a la Tienda</a>
      </div>
    </div>
  </main>

</body>
</html>`;
  }
}
