import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SESClient,
  SendTemplatedEmailCommand,
  GetTemplateCommand,
} from '@aws-sdk/client-ses';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderResponseDto, OrderItemResponseDto } from '../orders/dto/order-response.dto';
import { Transaction } from '../transactions/entities/transaction.entity';
import { NotificationTemplate } from './entities/notification-template.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly sesClient: SESClient;
  private readonly sourceEmail: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(NotificationTemplate)
    private readonly templateRepository: Repository<NotificationTemplate>,
  ) {
    const region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    this.sourceEmail = this.configService.get<string>(
      'SES_SOURCE_EMAIL',
      'dynamitesoftware21@gmail.com',
    );

    // Si se definen en .env se usan credenciales explícitas;
    // de lo contrario, el SDK de AWS utiliza automáticamente la cadena de credenciales por defecto (~/.aws/credentials, IAM Role, variables de entorno)
    if (accessKeyId && secretAccessKey && !accessKeyId.startsWith('your_')) {
      this.sesClient = new SESClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log(`Amazon SES Client inicializado con credenciales explícitas en región ${region} (Remitente: ${this.sourceEmail})`);
    } else {
      this.sesClient = new SESClient({ region });
      this.logger.log(`Amazon SES Client inicializado con proveedor de credenciales AWS por defecto en región ${region} (Remitente: ${this.sourceEmail})`);
    }
  }

  /**
   * Consulta el registro de la plantilla en la tabla de BD
   */
  async getTemplate(name: string): Promise<NotificationTemplate | null> {
    try {
      const template = await this.templateRepository.findOne({
        where: { name, isActive: true },
      });
      return template;
    } catch (err: any) {
      this.logger.warn(`Error al consultar la plantilla "${name}" en BD: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Obtiene el contenido de la plantilla directamente desde Amazon SES
   */
  async getTemplateFromSes(templateName: string): Promise<{ subject?: string; html?: string; text?: string } | null> {
    try {
      const response = await this.sesClient.send(
        new GetTemplateCommand({ TemplateName: templateName }),
      );
      return {
        subject: response.Template?.SubjectPart,
        html: response.Template?.HtmlPart,
        text: response.Template?.TextPart,
      };
    } catch (error: any) {
      this.logger.warn(`No se pudo obtener la plantilla "${templateName}" de SES: ${error?.message || error}`);
      return null;
    }
  }

  /**
   * Envía un correo electrónico REAL utilizando plantillas alojadas en Amazon SES (SendTemplatedEmailCommand)
   */
  async sendTemplatedEmail(
    to: string,
    templateName: string,
    templateData: Record<string, any>,
  ): Promise<boolean> {
    const serializedData = JSON.stringify(templateData);

    try {
      const command = new SendTemplatedEmailCommand({
        Source: this.sourceEmail,
        Destination: {
          ToAddresses: [to],
        },
        Template: templateName,
        TemplateData: serializedData,
      });

      const response = await this.sesClient.send(command);
      this.logger.log(
        `[SES EMAIL ENVIADO EXITOSAMENTE] MessageId: ${response.MessageId} | Para: ${to} | Plantilla: "${templateName}"`,
      );
      return true;
    } catch (error: any) {
      this.logger.error(
        `[SES ERROR] No se pudo enviar el correo vía Amazon SES a ${to}: ${error?.message || error}`,
      );

      // Si la cuenta SES está en modo Sandbox y el correo de destino no está verificado en AWS,
      // enviamos una copia de respaldo a la cuenta del remitente verificado para garantizar la entrega.
      if (
        (error?.message && error.message.includes('Email address is not verified')) &&
        to.toLowerCase() !== this.sourceEmail.toLowerCase()
      ) {
        this.logger.warn(
          `[SES SANDBOX] El destinatario ${to} no está verificado en Amazon SES Sandbox. Redirigiendo copia al remitente verificado (${this.sourceEmail})...`,
        );

        try {
          const fallbackCommand = new SendTemplatedEmailCommand({
            Source: this.sourceEmail,
            Destination: {
              ToAddresses: [this.sourceEmail],
            },
            Template: templateName,
            TemplateData: serializedData,
          });
          const fbResponse = await this.sesClient.send(fallbackCommand);
          this.logger.log(
            `[SES SANDBOX RESPALDO ENTREGADO] MessageId: ${fbResponse.MessageId} | Recibido en: ${this.sourceEmail}`,
          );
          return true;
        } catch (fbErr: any) {
          this.logger.error(`Error en fallback SES a ${this.sourceEmail}: ${fbErr?.message || fbErr}`);
        }
      }

      return false;
    }
  }

  /**
   * 1. Notificación: Pedido Creado
   * Usa la plantilla "OrderCreatedTemplate" alojada en Amazon SES
   */
  async sendOrderCreated(
    order: Order | OrderResponseDto,
    items: (OrderItem | OrderItemResponseDto)[],
  ): Promise<void> {
    const formattedTotal = (Number(order.totalAmount) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedDelivery = (Number(order.deliveryFeeAmount) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedSubtotal = (Number(order.subtotalAmount) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedTax = (Number(order.taxAmount || 0) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedDiscount = (Number(order.discountAmount || 0) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });

    const itemsSummary = items
      .map(
        (it) =>
          `- ${it.productName} x${it.quantity} - ${(
            (Number(it.unitPrice) * it.quantity) /
            100
          ).toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}`,
      )
      .join('\n');

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3001');

    const templateData = {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      itemsSummary,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      subtotalFormatted: formattedSubtotal,
      deliveryFeeFormatted: formattedDelivery,
      taxFormatted: formattedTax,
      ivaFormatted: formattedTax,
      discountFormatted: formattedDiscount,
      totalFormatted: formattedTotal,
      trackingUrl: `${frontendUrl}/orders/track/${order.orderNumber}?token=${order.accessToken}`,
    };

    await this.sendTemplatedEmail(order.customerEmail, 'OrderCreatedTemplate', templateData);
  }

  /**
   * 2. Notificación: Pago Aprobado y Pedido Entregado
   * Usa la plantilla "PaymentApprovedTemplate" alojada en Amazon SES
   */
  async sendPaymentApproved(
    order: Order | OrderResponseDto,
    transaction?: Transaction,
  ): Promise<void> {
    const formattedTotal = (Number(order.totalAmount) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedSubtotal = (Number(order.subtotalAmount) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedDelivery = (Number(order.deliveryFeeAmount) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });
    const formattedTax = (Number(order.taxAmount || 0) / 100).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3001');

    const templateData = {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      transactionReference: transaction?.gatewayTransactionId || transaction?.reference || order.orderNumber,
      subtotalFormatted: formattedSubtotal,
      deliveryFeeFormatted: formattedDelivery,
      taxFormatted: formattedTax,
      ivaFormatted: formattedTax,
      totalFormatted: formattedTotal,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      trackingUrl: `${frontendUrl}/orders/track/${order.orderNumber}?token=${order.accessToken}`,
    };

    await this.sendTemplatedEmail(order.customerEmail, 'PaymentApprovedTemplate', templateData);
  }

  /**
   * 3. Notificación: Pago Declinado / Rechazado
   * Usa la plantilla "PaymentDeclinedTemplate" alojada en Amazon SES
   */
  async sendPaymentDeclined(
    order: Order | OrderResponseDto,
    reason?: string,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const templateData = {
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      declineReason: reason || 'Transacción rechazada por la entidad bancaria.',
      retryUrl: `${frontendUrl}/checkout`,
    };

    await this.sendTemplatedEmail(order.customerEmail, 'PaymentDeclinedTemplate', templateData);
  }
}
