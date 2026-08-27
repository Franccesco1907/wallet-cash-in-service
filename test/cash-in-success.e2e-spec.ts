import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { FakePaymentProvider } from '../src/cash-in/infrastructure/payment/fake-payment-provider.adapter.js';
import { createTestApp } from './test-app.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';

describe('successful cash-in', () => {
  beforeEach(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
    await client.end();
    FakePaymentProvider.reset();
  });

  it('credits the wallet once and replays the stored completed response', async () => {
    const app = await createTestApp();
    const key = randomUUID();
    const body = {
      user_id: 'usr_success',
      amount: 100,
      currency: 'PEN',
      payment_method: 'fake_success',
    };
    const first = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(body);
    const replay = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(body);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const ledger = await client.query('SELECT * FROM wallet_ledger');
    const wallet = await client.query<{ balance_minor: string }>(
      'SELECT balance_minor FROM wallets WHERE user_id=$1',
      ['usr_success'],
    );
    await client.end();
    await app.close();

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      status: 'completed',
      amount: 100,
      new_balance: 100,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(ledger.rowCount).toBe(1);
    expect(wallet.rows[0]?.balance_minor).toBe('10000');
    expect(FakePaymentProvider.calls()).toBe(1);
  });
});
