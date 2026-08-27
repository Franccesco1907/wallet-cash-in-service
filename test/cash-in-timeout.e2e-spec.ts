import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { FakePaymentProvider } from '../src/cash-in/infrastructure/payment/fake-payment-provider.adapter.js';
import { createTestApp } from './test-app.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';

describe('uncertain payment outcome', () => {
  beforeEach(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
    await client.end();
    FakePaymentProvider.reset();
  });

  it('returns the same uncertain operation after a provider timeout without charging again', async () => {
    const app = await createTestApp();
    const key = randomUUID();
    const body = {
      user_id: 'usr_timeout',
      amount: 15,
      currency: 'PEN',
      payment_method: 'fake_timeout',
    };
    const first = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(body);
    const retry = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(body);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const operation = await client.query<{
      provider_request_key: string;
      status: string;
    }>('SELECT provider_request_key, status FROM cash_in_operations');
    const ledger = await client.query('SELECT 1 FROM wallet_ledger');
    await client.end();
    await app.close();

    expect(first.status).toBe(202);
    expect(first.body.status).toBe('awaiting_confirmation');
    expect(retry.body).toEqual(first.body);
    expect(operation.rows[0]?.status).toBe('AWAITING_CONFIRMATION');
    expect(operation.rows[0]?.provider_request_key).toBeTruthy();
    expect(FakePaymentProvider.calls()).toBe(1);
    expect(ledger.rowCount).toBe(0);
  });
});
