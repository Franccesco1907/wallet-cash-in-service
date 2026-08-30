import { randomUUID } from 'node:crypto';
import type { CreateOperationInput } from '../src/cash-in/application/ports/cash-in-store.port.ts';
import {
  OPERATION_STATE,
  type OperationState,
} from '../src/cash-in/domain/operation-state.ts';
import { AppDataSource } from '../src/database/data-source.ts';
import { expect } from 'vitest';

export const OLD_TIMESTAMP = new Date('2000-01-01T00:00:00.000Z');

export interface OperationStateRow {
  operation_id: string;
  status: string;
  failure_code: string | null;
  updated_at: Date;
}

export interface ProviderEventStateRow {
  provider_event_id: string;
  processing_status: string;
  processed_at: Date | null;
}

export interface OperationExpectation {
  operationId: string;
  status: OperationState;
}

export interface ProviderEventSeed {
  id: string;
  status: string;
}

export function createOperationInput(
  overrides: Partial<CreateOperationInput> = {},
): CreateOperationInput {
  return {
    operationId: randomUUID(),
    idempotencyKey: randomUUID(),
    requestFingerprint: 'a'.repeat(64),
    providerRequestKey: randomUUID(),
    userId: 'usr_store_characterization',
    amountMinor: 12345n,
    currency: 'PEN',
    paymentMethod: 'fake_pending',
    ...overrides,
  };
}

function indexBy<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [key(row), row]));
}

export function expectAwaitingTransitions(
  rows: OperationStateRow[],
  requestedId: string,
  createdId: string,
): void {
  const byId = indexBy(rows, (row) => row.operation_id);
  expect(byId.get(requestedId)).toMatchObject({
    status: 'AWAITING_CONFIRMATION',
  });
  expect(byId.get(requestedId)?.updated_at.getTime()).toBeGreaterThan(
    OLD_TIMESTAMP.getTime(),
  );
  expect(byId.get(createdId)).toMatchObject({
    status: 'CREATED',
    updated_at: OLD_TIMESTAMP,
  });
}

export function expectFailureTransitions(
  rows: OperationStateRow[],
  operations: OperationExpectation[],
): void {
  const byId = indexBy(rows, (row) => row.operation_id);
  for (const { operationId, status } of operations) {
    const row = byId.get(operationId);
    const canFail =
      status === OPERATION_STATE.PAYMENT_REQUESTED ||
      status === OPERATION_STATE.AWAITING_CONFIRMATION;
    expect(row?.status).toBe(canFail ? OPERATION_STATE.FAILED : status);
    expect(row?.failure_code).toBe(canFail ? 'NEW_FAILURE' : 'ORIGINAL_CODE');
    if (canFail)
      expect(row?.updated_at.getTime()).toBeGreaterThan(
        OLD_TIMESTAMP.getTime(),
      );
    else expect(row?.updated_at).toEqual(OLD_TIMESTAMP);
  }
}

export function expectProviderEventTransitions(
  rows: ProviderEventStateRow[],
): void {
  const byId = indexBy(rows, (row) => row.provider_event_id);
  expect(byId.get('evt_received')?.processing_status).toBe('PROCESSED');
  expect(byId.get('evt_received')?.processed_at?.getTime()).toBeGreaterThan(
    OLD_TIMESTAMP.getTime(),
  );
  expect(byId.get('evt_processed')).toMatchObject({
    processing_status: 'PROCESSED',
    processed_at: OLD_TIMESTAMP,
  });
  expect(byId.get('evt_ignored')).toMatchObject({
    processing_status: 'IGNORED_OLD',
    processed_at: OLD_TIMESTAMP,
  });
}

export async function forceOperationState(
  operationId: string,
  status: OperationState,
): Promise<void> {
  await AppDataSource.query(
    'UPDATE cash_in_operations SET status=$2, failure_code=$3, updated_at=$4 WHERE operation_id=$1',
    [operationId, status, 'ORIGINAL_CODE', OLD_TIMESTAMP],
  );
}

export async function insertProviderEvent(
  operationId: string,
  event: ProviderEventSeed,
  index: number,
): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO provider_events (provider_event_id, operation_id, event_type,
     event_sequence, payload_hash, processing_status, provider_payment_id, processed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      event.id,
      operationId,
      'payment.succeeded',
      String(index + 1),
      String(index).repeat(64),
      event.status,
      `pay_${index}`,
      OLD_TIMESTAMP,
    ],
  );
}
