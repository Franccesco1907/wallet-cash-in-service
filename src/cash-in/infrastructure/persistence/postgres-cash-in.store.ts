import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { withTransientTransactionRetry } from '../../../database/transaction-retry.js';
import {
  OPERATION_STATE,
  type OperationState,
} from '../../domain/operation-state.js';
import {
  PROVIDER_EVENT_DECISION,
  type CashInOperation,
  type CashInStorePort,
  type CompletionResult,
  type CreateOperationInput,
  type OperationClaim,
  type ProviderEventDecision,
  type ProviderEventInput,
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

interface ProviderEventRow {
  operation_id: string;
  provider_payment_id: string;
  event_type: string;
  event_sequence: string;
  payload_hash: string;
  processing_status: string;
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

  async markPaymentRequested(operationId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ status: string }>>(
        'SELECT status FROM cash_in_operations WHERE operation_id=$1 FOR UPDATE',
        [operationId],
      );
      if (rows[0]?.status !== OPERATION_STATE.CREATED) return false;
      await manager.query(
        `UPDATE cash_in_operations SET status=$2, updated_at=now()
         WHERE operation_id=$1`,
        [operationId, OPERATION_STATE.PAYMENT_REQUESTED],
      );
      return true;
    });
  }

  async getById(operationId: string): Promise<CashInOperation | null> {
    const rows = await this.dataSource.query<OperationRow[]>(
      'SELECT * FROM cash_in_operations WHERE operation_id=$1',
      [operationId],
    );
    return rows[0] ? mapOperation(rows[0]) : null;
  }

  async finalizeCompleted(
    operationId: string,
    providerPaymentId: string,
  ): Promise<CompletionResult> {
    return withTransientTransactionRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const operationRows = await manager.query<OperationRow[]>(
          'SELECT * FROM cash_in_operations WHERE operation_id=$1 FOR UPDATE',
          [operationId],
        );
        const row = operationRows[0];
        if (!row) throw new Error('Cash-in operation not found');
        if (row.status === OPERATION_STATE.COMPLETED) {
          return {
            operation: mapOperation(row),
            applied: false,
            resultingBalanceMinor: BigInt(row.completed_balance_minor ?? '0'),
          };
        }
        if (
          row.status !== OPERATION_STATE.PAYMENT_REQUESTED &&
          row.status !== OPERATION_STATE.AWAITING_CONFIRMATION
        ) {
          return {
            operation: mapOperation(row),
            applied: false,
            resultingBalanceMinor: null,
          };
        }
        await manager.query(
          `INSERT INTO wallet_ledger
         (ledger_id, operation_id, user_id, currency, amount_minor, resulting_balance_minor)
         VALUES ($1,$2,$3,$4,$5,0)
         ON CONFLICT (operation_id) DO NOTHING`,
          [
            randomUUID(),
            row.operation_id,
            row.user_id,
            row.currency,
            row.amount_minor,
          ],
        );
        await manager.query(
          `INSERT INTO wallets (user_id, currency, balance_minor)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id, currency) DO UPDATE
           SET balance_minor = wallets.balance_minor + EXCLUDED.balance_minor,
               updated_at = now()
        `,
          [row.user_id, row.currency, row.amount_minor],
        );
        const walletRows = await manager.query<
          Array<{ balance_minor: string }>
        >(
          'SELECT balance_minor FROM wallets WHERE user_id=$1 AND currency=$2',
          [row.user_id, row.currency],
        );
        const balance = BigInt(walletRows[0]?.balance_minor ?? '0');
        await manager.query(
          'UPDATE wallet_ledger SET resulting_balance_minor=$2 WHERE operation_id=$1',
          [operationId, balance.toString()],
        );
        await manager.query(
          `UPDATE cash_in_operations
         SET status=$2, provider_payment_id=$3, completed_balance_minor=$4, updated_at=now()
         WHERE operation_id=$1`,
          [
            operationId,
            OPERATION_STATE.COMPLETED,
            providerPaymentId,
            balance.toString(),
          ],
        );
        const completedRows = await manager.query<OperationRow[]>(
          'SELECT * FROM cash_in_operations WHERE operation_id=$1',
          [operationId],
        );
        return {
          operation: mapOperation(completedRows[0]!),
          applied: true,
          resultingBalanceMinor: balance,
        };
      }),
    );
  }

  async markFailed(operationId: string, failureCode: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE cash_in_operations
       SET status=$2, failure_code=$3, updated_at=now()
       WHERE operation_id=$1 AND status IN ($4,$5)`,
      [
        operationId,
        OPERATION_STATE.FAILED,
        failureCode,
        OPERATION_STATE.PAYMENT_REQUESTED,
        OPERATION_STATE.AWAITING_CONFIRMATION,
      ],
    );
  }

  async markAwaitingConfirmation(operationId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE cash_in_operations SET status=$2, updated_at=now()
       WHERE operation_id=$1 AND status=$3`,
      [
        operationId,
        OPERATION_STATE.AWAITING_CONFIRMATION,
        OPERATION_STATE.PAYMENT_REQUESTED,
      ],
    );
  }

  async recordProviderEvent(
    input: ProviderEventInput,
  ): Promise<ProviderEventDecision> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        input.eventId,
      ]);
      const duplicates = await manager.query<ProviderEventRow[]>(
        `SELECT operation_id, provider_payment_id, event_type,
                event_sequence, payload_hash, processing_status
         FROM provider_events WHERE provider_event_id=$1`,
        [input.eventId],
      );
      if (duplicates[0]) {
        const existing = duplicates[0];
        const identityMatches =
          existing.operation_id === input.operationId &&
          existing.provider_payment_id === input.providerPaymentId &&
          existing.event_type === input.eventType &&
          existing.event_sequence === input.sequence.toString() &&
          existing.payload_hash === input.payloadHash;
        if (!identityMatches) return PROVIDER_EVENT_DECISION.MISMATCH;
        return duplicates[0].processing_status === 'RECEIVED'
          ? PROVIDER_EVENT_DECISION.PROCESS
          : PROVIDER_EVENT_DECISION.DUPLICATE;
      }

      const operations = await manager.query<
        Array<{ provider_event_sequence: string }>
      >(
        'SELECT provider_event_sequence FROM cash_in_operations WHERE operation_id=$1 FOR UPDATE',
        [input.operationId],
      );
      if (!operations[0]) throw new Error('Webhook operation not found');
      const decision =
        input.sequence <= BigInt(operations[0].provider_event_sequence)
          ? PROVIDER_EVENT_DECISION.OLD
          : PROVIDER_EVENT_DECISION.PROCESS;
      await manager.query(
        `INSERT INTO provider_events
         (provider_event_id, operation_id, event_type, event_sequence, payload_hash,
          processing_status, provider_payment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.eventId,
          input.operationId,
          input.eventType,
          input.sequence.toString(),
          input.payloadHash,
          decision === PROVIDER_EVENT_DECISION.PROCESS
            ? 'RECEIVED'
            : 'IGNORED_OLD',
          input.providerPaymentId,
        ],
      );
      if (decision === PROVIDER_EVENT_DECISION.PROCESS) {
        await manager.query(
          'UPDATE cash_in_operations SET provider_event_sequence=$2 WHERE operation_id=$1',
          [input.operationId, input.sequence.toString()],
        );
      }
      return decision;
    });
  }

  async markProviderEventProcessed(eventId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE provider_events
       SET processing_status='PROCESSED', processed_at=now()
       WHERE provider_event_id=$1 AND processing_status='RECEIVED'`,
      [eventId],
    );
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
