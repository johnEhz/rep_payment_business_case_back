import { Transaction, TransactionStatus } from '../entities/transaction.entity';

export class TransactionResponseDto {
  id: string;
  orderId: string;
  reference: string;
  gatewayTransactionId: string | null;
  amountInCents: number;
  totalAmountInCents: number;
  currency: string;
  paymentMethod: string;
  status: TransactionStatus;
  statusMessage: string | null;
  installments: number;
  orderNumber?: string | null;
  customerFullName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryCity?: string | null;
  createdAt: Date;
}

export function toTransactionResponseDto(transaction: Transaction): TransactionResponseDto {
  return {
    id: transaction.id,
    orderId: transaction.orderId,
    reference: transaction.reference,
    gatewayTransactionId: transaction.gatewayTransactionId || null,
    amountInCents: Number(transaction.amountInCents || 0),
    totalAmountInCents: Number(transaction.amountInCents || 0),
    currency: transaction.currency || 'COP',
    paymentMethod: transaction.paymentMethod || 'CARD',
    status: transaction.status,
    statusMessage: transaction.statusMessage || null,
    installments: transaction.installments || 1,
    orderNumber: transaction.order?.orderNumber || null,
    customerFullName: transaction.order?.customerName || null,
    customerEmail: transaction.order?.customerEmail || null,
    customerPhone: transaction.order?.customerPhone || null,
    deliveryAddress: transaction.order?.deliveryAddress || null,
    deliveryCity: transaction.order?.deliveryCity || null,
    createdAt: transaction.createdAt,
  };
}
