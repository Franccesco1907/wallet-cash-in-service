import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { withTransientTransactionRetry } from '../../../database/transaction-retry.ts';
import { OPERATION_STATE } from '../../domain/operation-state.ts';
import {
  PROVIDER_EVENT_DECISION,
  type CashInOperation,
  type CashInStorePort,
  type CompletionResult,
  type CreateOperationInput,
  type OperationClaim,
  ProviderPaymentConflictError,
  type ProviderEventDecision,
  type ProviderEventInput,
} from '../../application/ports/cash-in-store.port.ts';
import { mapOperation } from './postgres-cash-in.mapper.ts';
import type {
  OperationRow,
  ProviderEventRow,
} from './postgres-cash-in.rows.ts';

interface CashInOperationTable extends OperationRow {
  provider_event_sequence: string;
  created_at: Date;
  updated_at: Date;
}

interface ProviderEventTable extends ProviderEventRow {
  provider_event_id: string;
  created_at: Date;
  processed_at: Date | null;
}

function matchesProviderPaymentConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'UQ_cash_in_operations_provider_payment_id'
  );
}

function isProviderPaymentConflict(error: unknown): boolean {
  if (matchesProviderPaymentConflict(error)) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'driverError' in error &&
    matchesProviderPaymentConflict(error.driverError)
  );
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
    const row = await this.dataSource
      .createQueryBuilder()
      .select('*')
      .from<CashInOperationTable>('cash_in_operations', 'operation')
      .where('operation.operation_id = :operationId', { operationId })
      .getRawOne<OperationRow>();
    return row ? mapOperation(row) : null;
  }

  async finalizeCompleted(
    operationId: string,
    providerPaymentId: string,
  ): Promise<CompletionResult> {
    try {
      return await withTransientTransactionRetry(() =>
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
    } catch (error: unknown) {
      if (isProviderPaymentConflict(error)) {
        throw new ProviderPaymentConflictError();
      }
      throw error;
    }
  }

  async markFailed(operationId: string, failureCode: string): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update<CashInOperationTable>('cash_in_operations')
      .set({
        status: OPERATION_STATE.FAILED,
        failure_code: failureCode,
        updated_at: () => 'now()',
      })
      .where('operation_id = :operationId', { operationId })
      .andWhere('status IN (:...allowedStatuses)', {
        allowedStatuses: [
          OPERATION_STATE.PAYMENT_REQUESTED,
          OPERATION_STATE.AWAITING_CONFIRMATION,
        ],
      })
      .execute();
  }

  async markAwaitingConfirmation(operationId: string): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .update<CashInOperationTable>('cash_in_operations')
      .set({
        status: OPERATION_STATE.AWAITING_CONFIRMATION,
        updated_at: () => 'now()',
      })
      .where('operation_id = :operationId', { operationId })
      .andWhere('status = :expectedStatus', {
        expectedStatus: OPERATION_STATE.PAYMENT_REQUESTED,
      })
      .execute();
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
    await this.dataSource
      .createQueryBuilder()
      .update<ProviderEventTable>('provider_events')
      .set({
        processing_status: 'PROCESSED',
        processed_at: () => 'now()',
      })
      .where('provider_event_id = :eventId', { eventId })
      .andWhere('processing_status = :expectedStatus', {
        expectedStatus: 'RECEIVED',
      })
      .execute();
  }

  private async findByIdempotencyKey(
    key: string,
  ): Promise<CashInOperation | null> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('*')
      .from<CashInOperationTable>('cash_in_operations', 'operation')
      .where('operation.idempotency_key = :key', { key })
      .getRawOne<OperationRow>();
    return row ? mapOperation(row) : null;
  }
}
