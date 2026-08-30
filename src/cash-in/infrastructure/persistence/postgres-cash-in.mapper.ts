import type { CashInOperation } from '../../application/ports/cash-in-store.port.ts';
import type { OperationState } from '../../domain/operation-state.ts';
import type { OperationRow } from './postgres-cash-in.rows.ts';

export function mapOperation(row: OperationRow): CashInOperation {
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
