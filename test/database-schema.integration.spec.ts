import { Client } from 'pg';

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
  });
});
