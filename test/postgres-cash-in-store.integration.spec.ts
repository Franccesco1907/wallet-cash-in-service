import { randomUUID } from 'node:crypto';
import { OPERATION_STATE } from '../src/cash-in/domain/operation-state.ts';
import { PostgresCashInStore } from '../src/cash-in/infrastructure/persistence/postgres-cash-in.store.ts';
import { AppDataSource } from '../src/database/data-source.ts';
import {
  OLD_TIMESTAMP,
  createOperationInput,
  expectAwaitingTransitions,
  expectFailureTransitions,
  expectProviderEventTransitions,
  forceOperationState,
  insertProviderEvent,
  type OperationStateRow,
  type ProviderEventStateRow,
} from './postgres-cash-in-store.helpers.ts';

describe('PostgresCashInStore', () => {
  let store: PostgresCashInStore;
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    store = new PostgresCashInStore(AppDataSource);
  });
  beforeEach(async () => {
    await AppDataSource.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
  });
  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it('getById returns a mapped operation and null when it is absent', async () => {
    const input = createOperationInput();
    await store.createOrGet(input);
    await AppDataSource.query(
      `UPDATE cash_in_operations SET status=$2, provider_payment_id=$3,
       failure_code=$4, completed_balance_minor=$5 WHERE operation_id=$1`,
      [
        input.operationId,
        OPERATION_STATE.COMPLETED,
        'pay_characterization',
        'HISTORICAL_CODE',
        '23456',
      ],
    );
    await expect(store.getById(input.operationId)).resolves.toEqual({
      ...input,
      status: OPERATION_STATE.COMPLETED,
      providerPaymentId: 'pay_characterization',
      failureCode: 'HISTORICAL_CODE',
      completedBalanceMinor: 23456n,
    });
    await expect(store.getById(randomUUID())).resolves.toBeNull();
  });

  it('markAwaitingConfirmation only transitions PAYMENT_REQUESTED', async () => {
    const [requested, created] = [
      createOperationInput(),
      createOperationInput(),
    ];
    await store.createOrGet(requested);
    await store.createOrGet(created);
    await store.markPaymentRequested(requested.operationId);
    await AppDataSource.query(
      'UPDATE cash_in_operations SET updated_at=$1 WHERE operation_id IN ($2,$3)',
      [OLD_TIMESTAMP, requested.operationId, created.operationId],
    );
    await store.markAwaitingConfirmation(requested.operationId);
    await store.markAwaitingConfirmation(created.operationId);
    const rows = await AppDataSource.query<OperationStateRow[]>(
      'SELECT operation_id, status, failure_code, updated_at FROM cash_in_operations',
    );
    expectAwaitingTransitions(rows, requested.operationId, created.operationId);
  });

  it('markFailed only transitions PAYMENT_REQUESTED and AWAITING_CONFIRMATION', async () => {
    const operations = await Promise.all(
      Object.values(OPERATION_STATE).map(async (status) => {
        const input = createOperationInput();
        await store.createOrGet(input);
        await forceOperationState(input.operationId, status);
        return { operationId: input.operationId, status };
      }),
    );
    await Promise.all(
      operations.map(({ operationId }) =>
        store.markFailed(operationId, 'NEW_FAILURE'),
      ),
    );
    const rows = await AppDataSource.query<OperationStateRow[]>(
      'SELECT operation_id, status, failure_code, updated_at FROM cash_in_operations',
    );
    expectFailureTransitions(rows, operations);
  });

  it('markProviderEventProcessed only transitions RECEIVED', async () => {
    const operation = createOperationInput();
    await store.createOrGet(operation);
    const events = [
      { id: 'evt_received', status: 'RECEIVED' },
      { id: 'evt_processed', status: 'PROCESSED' },
      { id: 'evt_ignored', status: 'IGNORED_OLD' },
    ];
    for (const [index, event] of events.entries()) {
      await insertProviderEvent(operation.operationId, event, index);
    }
    await Promise.all(
      events.map(({ id }) => store.markProviderEventProcessed(id)),
    );
    const rows = await AppDataSource.query<ProviderEventStateRow[]>(
      'SELECT provider_event_id, processing_status, processed_at FROM provider_events',
    );
    expectProviderEventTransitions(rows);
  });

  it('createOrGet replays the operation found by idempotency key', async () => {
    const original = createOperationInput();
    const first = await store.createOrGet(original);
    const replay = await store.createOrGet(
      createOperationInput({ idempotencyKey: original.idempotencyKey }),
    );
    expect(first.authorized).toBe(true);
    expect(replay).toEqual({
      operation: {
        ...original,
        status: OPERATION_STATE.CREATED,
        providerPaymentId: null,
        failureCode: null,
        completedBalanceMinor: null,
      },
      authorized: false,
    });
  });
});
