import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export enum IdempotencyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface IdempotentRecord {
  key: string;
  status: IdempotencyStatus;
  requestHash: string;
  statusCode?: number;
  responseBody?: any;
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  // Almacenamiento de idempotencia en memoria con TTL
  private readonly store = new Map<string, IdempotentRecord>();

  // TTL por defecto: 24 horas
  private readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor() {
    // Limpieza periódica de registros expirados cada 30 minutos
    setInterval(() => this.cleanup(), 30 * 60 * 1000);
  }

  /**
   * Genera un hash del contenido de la petición para asegurar que la misma clave
   * no se reuse con un payload diferente (tampering)
   */
  hashPayload(payload: any): string {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Intenta adquirir el bloqueo de idempotencia para la clave especificada
   */
  acquireLock(
    key: string,
    requestHash: string,
  ): { status: 'ACQUIRED' | 'IN_PROGRESS' | 'REPLAY' | 'PAYLOAD_MISMATCH'; record?: IdempotentRecord } {
    const existing = this.store.get(key);

    if (existing) {
      if (existing.expiresAt.getTime() < Date.now()) {
        this.store.delete(key);
      } else {
        if (existing.requestHash !== requestHash) {
          this.logger.warn(`Idempotency key ${key} reused with DIFFERENT payload hash!`);
          return { status: 'PAYLOAD_MISMATCH', record: existing };
        }

        if (existing.status === IdempotencyStatus.IN_PROGRESS) {
          return { status: 'IN_PROGRESS', record: existing };
        }

        if (existing.status === IdempotencyStatus.COMPLETED) {
          return { status: 'REPLAY', record: existing };
        }
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.DEFAULT_TTL_MS);

    const newRecord: IdempotentRecord = {
      key,
      status: IdempotencyStatus.IN_PROGRESS,
      requestHash,
      createdAt: now,
      expiresAt,
    };

    this.store.set(key, newRecord);
    return { status: 'ACQUIRED', record: newRecord };
  }

  /**
   * Guarda el resultado exitoso para la clave de idempotencia
   */
  complete(key: string, statusCode: number, responseBody: any): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.status = IdempotencyStatus.COMPLETED;
      existing.statusCode = statusCode;
      existing.responseBody = responseBody;
      this.logger.log(`Idempotency key ${key} marked COMPLETED (status: ${statusCode})`);
    }
  }

  /**
   * Libera o marca como fallida la clave en caso de excepción no recuperable
   */
  release(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (record.expiresAt.getTime() <= now) {
        this.store.delete(key);
      }
    }
  }
}
