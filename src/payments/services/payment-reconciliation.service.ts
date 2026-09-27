import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Transaction, TransactionStatus } from '../../transactions/entities/transaction.entity';
import { PaymentStatusService } from './payment-status.service';
import { PAYMENT_GATEWAY } from '../interfaces/payment-gateway.interface';
import type { IPaymentGateway } from '../interfaces/payment-gateway.interface';

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private isRunning = false;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly paymentStatusService: PaymentStatusService,
    @Inject(PAYMENT_GATEWAY)
    private readonly paymentGateway: IPaymentGateway,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingTransactions() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const pendingTransactions = await this.transactionRepository.find({
        where: {
          status: TransactionStatus.PENDING,
          createdAt: LessThan(oneMinuteAgo),
        },
        order: { createdAt: 'ASC' },
        take: 20,
      });

      if (pendingTransactions.length === 0) {
        return;
      }

      this.logger.log(
        `[Reconciliation] Found ${pendingTransactions.length} PENDING transactions to reconcile with payment gateway`,
      );

      for (const tx of pendingTransactions) {
        try {
          const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
          if (tx.createdAt < thirtyMinutesAgo && !tx.gatewayTransactionId) {
            this.logger.warn(
              `[Reconciliation] Transaction ${tx.id} (${tx.reference}) has been PENDING for >30m with no gateway id. Marking EXPIRED.`,
            );
            await this.paymentStatusService.applyTransactionStatus({
              reference: tx.reference,
              status: 'EXPIRED',
              statusMessage: 'Transaction timed out after 30 minutes in PENDING state',
              source: 'RECONCILIATION',
            });
            continue;
          }

          if (!tx.gatewayTransactionId) {
            this.logger.debug(
              `[Reconciliation] Transaction ${tx.reference} does not have a gatewayTransactionId yet. Waiting for webhook.`,
            );
            continue;
          }
          this.logger.log(
            `[Reconciliation] Querying payment gateway for transaction ${tx.gatewayTransactionId} (${tx.reference})`,
          );
          const gatewayResult = await this.paymentGateway.getTransactionStatus(tx.gatewayTransactionId);

          if (gatewayResult && gatewayResult.status && gatewayResult.status !== 'PENDING') {
            this.logger.log(
              `[Reconciliation] Payment gateway returned terminal status ${gatewayResult.status} for ${tx.reference}. Applying via PaymentStatusService...`,
            );

            await this.paymentStatusService.applyTransactionStatus({
              providerTransactionId: tx.gatewayTransactionId,
              reference: tx.reference,
              status: gatewayResult.status as any,
              statusMessage: gatewayResult.statusMessage || gatewayResult.errorMessage,
              rawData: gatewayResult.rawResponse,
              source: 'RECONCILIATION',
            });
          } else {
            this.logger.debug(
              `[Reconciliation] Transaction ${tx.gatewayTransactionId} is still PENDING on gateway.`,
            );
          }
        } catch (txErr: any) {
          this.logger.error(
            `[Reconciliation] Failed to reconcile transaction ${tx.id} (${tx.reference})`,
            txErr?.message || txErr,
          );
        }
      }
    } catch (err: any) {
      this.logger.error('[Reconciliation] Error during reconciliation cron execution', err);
    } finally {
      this.isRunning = false;
    }
  }
}
