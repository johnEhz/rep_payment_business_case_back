import { Order, OrderStatus } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Delivery, DeliveryStatus } from '../../delivery/entities/delivery.entity';

export class OrderItemResponseDto {
  productId: string;
  productName: string;
  imageUrl?: string | null;
  unitPrice: number;
  unitBasePrice?: number;
  taxRate?: number;
  taxAmount?: number;
  subtotal?: number;
  quantity: number;
  totalAmount: number;
}

export class OrderDeliveryResponseDto {
  status: DeliveryStatus;
  address: string;
  city: string;
  feeAmount: number;
  estimatedDeliveryAt: Date | null;
  deliveredAt: Date | null;
}

export class OrderResponseDto {
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerPhoneExtension?: string | null;
  deliveryAddress: string;
  deliveryNeighborhood?: string | null;
  deliveryCity: string;
  deliveryDepartment: string;
  deliveryCountry: string;
  subtotalAmount: number;
  productsTotalAmount?: number;
  feeAmount: number;
  deliveryFeeAmount: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  expiresAt: Date;
  paidAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  accessToken: string;
  items: OrderItemResponseDto[];
  delivery: OrderDeliveryResponseDto | null;
  termsAccepted?: boolean;
  termsAcceptedAt?: Date | null;
  termsPermalink?: string | null;
  transaction?: TransactionSummaryDto | null;
}

export interface TransactionSummaryDto {
  reference: string;
  status: string;
  totalAmountInCents: number;
  paymentMethod?: string;
  installments?: number;
  createdAt?: Date;
}

export function toOrderItemResponseDto(item: OrderItem): OrderItemResponseDto {
  return {
    productId: item.productId,
    productName: item.productName,
    imageUrl: item.product?.imageUrl || null,
    unitPrice: Number(item.unitPrice),
    unitBasePrice: Number(item.unitBasePrice || 0),
    taxRate: Number(item.taxRate || 0),
    taxAmount: Number(item.taxAmount || 0),
    subtotal: Number(item.subtotal || 0),
    quantity: item.quantity,
    totalAmount: Number(item.totalAmount),
  };
}

export function toOrderDeliveryResponseDto(delivery?: Delivery | null): OrderDeliveryResponseDto | null {
  if (!delivery) return null;
  return {
    status: delivery.status,
    address: delivery.address,
    city: delivery.city,
    feeAmount: Number(delivery.feeAmount),
    estimatedDeliveryAt: delivery.estimatedDeliveryAt || null,
    deliveredAt: delivery.deliveredAt || null,
  };
}

export function toOrderResponseDto(order: Order): OrderResponseDto {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerPhoneExtension: order.customerPhoneExtension || null,
    deliveryAddress: order.deliveryAddress,
    deliveryNeighborhood: order.deliveryNeighborhood || null,
    deliveryCity: order.deliveryCity,
    deliveryDepartment: order.deliveryDepartment || 'Antioquia',
    deliveryCountry: order.deliveryCountry || 'Colombia',
    subtotalAmount: Number(order.subtotalAmount),
    productsTotalAmount: Number(order.subtotalAmount) + Number(order.taxAmount || 0),
    feeAmount: Number(order.feeAmount || 0),
    deliveryFeeAmount: Number(order.deliveryFeeAmount),
    discountAmount: Number(order.discountAmount || 0),
    taxAmount: Number(order.taxAmount || 0),
    totalAmount: Number(order.totalAmount),
    currency: 'COP',
    expiresAt: order.expiresAt,
    paidAt: order.paidAt || null,
    deliveredAt: order.deliveredAt || null,
    createdAt: order.createdAt,
    accessToken: order.accessToken,
    items: (order.items || []).map(toOrderItemResponseDto),
    delivery: toOrderDeliveryResponseDto(order.delivery),
    termsAccepted: order.termsAccepted ?? false,
    termsAcceptedAt: order.termsAcceptedAt || null,
    termsPermalink: order.termsPermalink || null,
    transaction:
      order.transactions && order.transactions.length > 0
        ? (() => {
            const approved = order.transactions.find((t) => t.status === 'APPROVED');
            const target = approved || order.transactions[order.transactions.length - 1];
            return {
              reference: target.reference,
              status: target.status,
              totalAmountInCents: Number(target.amountInCents ?? target.totalAmountInCents),
              paymentMethod: target.paymentMethod,
              installments: target.installments,
              createdAt: target.createdAt,
            };
          })()
        : null,
  };
}
