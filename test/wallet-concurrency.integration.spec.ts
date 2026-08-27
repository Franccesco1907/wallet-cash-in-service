import { randomUUID } from 'node:crypto';
import { AppDataSource } from '../src/database/data-source.js';
import { PostgresCashInStore } from '../src/cash-in/infrastructure/persistence/postgres-cash-in.store.js';
import { withTransientTransactionRetry } from '../src/database/transaction-retry.js';

describe('wallet balance concurrency', () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it('preserves both credits for concurrent operations on the same wallet', async () => {
    await AppDataSource.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
    const store = new PostgresCashInStore(AppDataSource);
    const operationIds = [randomUUID(), randomUUID()];
    const amounts = [1000n, 2000n];
    for (let index = 0; index < operationIds.length; index += 1) {
      await store.createOrGet({
        operationId: operationIds[index]!,
        idempotencyKey: randomUUID(),
        requestFingerprint: `${index}`.padStart(64, '0'),
        providerRequestKey: randomUUID(),
        userId: 'usr_concurrent',
        amountMinor: amounts[index]!,
        currency: 'PEN',
        paymentMethod: `fake_${index}`,
      });
      await store.markPaymentRequested(operationIds[index]!);
    }

    await Promise.all(
      operationIds.map((id) => store.finalizeCompleted(id, `pay_${id}`)),
    );
    const wallet = await AppDataSource.query<Array<{ balance_minor: string }>>(
      'SELECT balance_minor FROM wallets WHERE user_id=$1 AND currency=$2',
      ['usr_concurrent', 'PEN'],
    );
    const ledger = await AppDataSource.query<Array<{ operation_id: string }>>(
      'SELECT operation_id FROM wallet_ledger WHERE user_id=$1',
      ['usr_concurrent'],
    );

    expect(wallet[0]?.balance_minor).toBe('3000');
    expect(new Set(ledger.map((row) => row.operation_id))).toEqual(
      new Set(operationIds),
    );
  });

  it('retries one transient deadlock and returns the successful result', async () => {
    let attempts = 0;
    const result = await withTransientTransactionRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      }
      return 'completed';
    });
    expect(result).toBe('completed');
    expect(attempts).toBe(2);
  });
});
