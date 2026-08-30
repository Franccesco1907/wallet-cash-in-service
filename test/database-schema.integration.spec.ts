import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ProviderPaymentUniqueness2026082800001 } from '../src/database/migrations/2026082800001-provider-payment-uniqueness.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';

describe('database schema', () => {
  it('applies the initial migration with the required financial constraints', async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const result = await client.query<{ constraint_name: string }>(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND constraint_type IN ('PRIMARY KEY', 'UNIQUE')
    `);
    const constraints = result.rows.map((row) => row.constraint_name);
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='provider_events'
    `);
    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename='cash_in_operations'
    `);
    await client.end();
    expect(constraints).toEqual(
      expect.arrayContaining([
        'UQ_cash_in_operations_idempotency_key',
        'UQ_cash_in_operations_provider_request_key',
        'UQ_wallet_ledger_operation_id',
        'UQ_provider_events_provider_event_id',
      ]),
    );
    expect(columns.rows.map((row) => row.column_name)).toContain(
      'provider_payment_id',
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      'UQ_cash_in_operations_provider_payment_id',
    );
  });

  it('reverts and reapplies provider payment uniqueness', async () => {
    const dataSource = new DataSource({ type: 'postgres', url: databaseUrl });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    const migration = new ProviderPaymentUniqueness2026082800001();

    try {
      await migration.down(queryRunner);
      const afterDown = await queryRunner.query<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='UQ_cash_in_operations_provider_payment_id'`,
      );
      expect(afterDown).toEqual([]);

      await migration.up(queryRunner);
      const afterUp = await queryRunner.query<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='UQ_cash_in_operations_provider_payment_id'`,
      );
      expect(afterUp).toHaveLength(1);
    } finally {
      const indexes = await queryRunner.query<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname='public'
           AND indexname='UQ_cash_in_operations_provider_payment_id'`,
      );
      if (indexes.length === 0) await migration.up(queryRunner);
      await queryRunner.release();
      await dataSource.destroy();
    }
  });
});
