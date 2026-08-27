import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { FakePaymentProvider } from '../src/cash-in/infrastructure/payment/fake-payment-provider.adapter.js';
import { createTestApp } from './test-app.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';

describe('cash-in terminal failures', () => {
  beforeEach(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
    await client.end();
    FakePaymentProvider.reset();
  });

  it('replays a confirmed provider rejection without crediting the wallet', async () => {
    const app = await createTestApp();
    const key = randomUUID();
    const body = {
      user_id: 'usr_failed',
      amount: '20.00',
      currency: 'PEN',
      payment_method: 'fake_decline',
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
    const ledger = await client.query('SELECT 1 FROM wallet_ledger');
    await client.end();
    await app.close();

    expect(first.status).toBe(422);
    expect(first.body).toMatchObject({
      status: 'failed',
      error_code: 'PAYMENT_DECLINED',
    });
    expect(replay.body).toEqual(first.body);
    expect(FakePaymentProvider.calls()).toBe(1);
    expect(ledger.rowCount).toBe(0);
  });

  it('returns conflict when the same key is reused for a different payload', async () => {
    const app = await createTestApp();
    const key = randomUUID();
    const base = {
      user_id: 'usr_conflict',
      amount: '10.00',
      currency: 'PEN',
      payment_method: 'fake_success',
    };
    await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(base);
    const conflict = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send({ ...base, amount: '11.00' });
    await app.close();
    expect(conflict.status).toBe(409);
    expect(FakePaymentProvider.calls()).toBe(1);
  });
});
