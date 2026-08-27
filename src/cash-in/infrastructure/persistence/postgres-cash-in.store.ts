import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  OPERATION_STATE,
  type OperationState,
} from '../../domain/operation-state.js';
import type {
  CashInOperation,
  CashInStorePort,
  CreateOperationInput,
  OperationClaim,
} from '../../application/ports/cash-in-store.port.js';

interface OperationRow {
  operation_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  provider_request_key: string;
  user_id: string;
  amount_minor: string;
  currency: string;
  payment_method: string;
  status: string;
  provider_payment_id: string | null;
  failure_code: string | null;
  completed_balance_minor: string | null;
}

function mapOperation(row: OperationRow): CashInOperation {
  return {
    operationId: row.operation_id,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    providerRequestKey: row.provider_request_key,
    userId: row.user_id,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    paymentMethod: row.payment_method,
    status: row.status as OperationState,
    providerPaymentId: row.provider_payment_id,
    failureCode: row.failure_code,
    completedBalanceMinor:
      row.completed_balance_minor === null
        ? null
        : BigInt(row.completed_balance_minor),
  };
}

@Injectable()
export class PostgresCashInStore implements CashInStorePort {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async createOrGet(input: CreateOperationInput): Promise<OperationClaim> {
    const rows = await this.dataSource.query<OperationRow[]>(
      `INSERT INTO cash_in_operations
       (operation_id, idempotency_key, request_fingerprint, provider_request_key,
        user_id, amount_minor, currency, payment_method, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        input.operationId,
        input.idempotencyKey,
        input.requestFingerprint,
        input.providerRequestKey,
        input.userId,
        input.amountMinor.toString(),
        input.currency,
        input.paymentMethod,
        OPERATION_STATE.CREATED,
      ],
    );
    if (rows[0]) return { operation: mapOperation(rows[0]), authorized: true };
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (!existing)
      throw new Error('Operation disappeared after idempotency conflict');
    return { operation: existing, authorized: false };
  }

  async markPaymentRequested(operationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE cash_in_operations SET status=$2, updated_at=now()
       WHERE operation_id=$1 AND status=$3`,
      [operationId, OPERATION_STATE.PAYMENT_REQUESTED, OPERATION_STATE.CREATED],
    );
  }

  async getById(operationId: string): Promise<CashInOperation | null> {
    const rows = await this.dataSource.query<OperationRow[]>(
      'SELECT * FROM cash_in_operations WHERE operation_id=$1',
      [operationId],
    );
    return rows[0] ? mapOperation(rows[0]) : null;
  }

  private async findByIdempotencyKey(
    key: string,
  ): Promise<CashInOperation | null> {
    const rows = await this.dataSource.query<OperationRow[]>(
      'SELECT * FROM cash_in_operations WHERE idempotency_key=$1',
      [key],
    );
    return rows[0] ? mapOperation(rows[0]) : null;
  }
}
