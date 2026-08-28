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
      amount: '100.00',
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

  it('accepts the challenge numeric payload and returns numeric money', async () => {
    const app = await createTestApp();
    const response = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', randomUUID())
      .send({
        user_id: 'usr_challenge_contract',
        amount: 100.0,
        currency: 'PEN',
        payment_method: 'fake_success',
      });
    await app.close();
    expect(response.status).toBe(200);
    expect(response.body.amount).toBe(100);
    expect(response.body.new_balance).toBe(100);
  });

  it('accepts the maximum amount and rejects one cent above it', async () => {
    const app = await createTestApp();
    const maximum = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', randomUUID())
      .send({
        user_id: 'usr_maximum',
        amount: '1000000.00',
        currency: 'PEN',
        payment_method: 'fake_success',
      });
    const oversized = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', randomUUID())
      .send({
        user_id: 'usr_oversized',
        amount: '1000000.01',
        currency: 'PEN',
        payment_method: 'fake_success',
      });
    await app.close();
    expect(maximum.status).toBe(200);
    expect(maximum.body.amount).toBe(1000000);
    expect(maximum.body.new_balance).toBe(1000000);
    expect(oversized.status).toBe(400);
  });

  it('returns exact decimal text when a numeric balance cannot round-trip to cents', async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      `INSERT INTO wallets (user_id, currency, balance_minor)
       VALUES ($1, $2, $3)`,
      ['usr_round_trip_boundary', 'PEN', '9007199254740000'],
    );
    await client.end();

    const app = await createTestApp();
    const response = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', randomUUID())
      .send({
        user_id: 'usr_round_trip_boundary',
        amount: '0.01',
        currency: 'PEN',
        payment_method: 'fake_success',
      });
    await app.close();

    expect(response.status).toBe(200);
    expect(response.body.amount).toBe(0.01);
    expect(response.body.new_balance).toBe('90071992547400.01');
  });
});
