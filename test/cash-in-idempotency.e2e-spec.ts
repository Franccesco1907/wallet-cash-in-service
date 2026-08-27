import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Client } from 'pg';
import { FakePaymentProvider } from '../src/cash-in/infrastructure/payment/fake-payment-provider.adapter.js';
import { createTestApp } from './test-app.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';

describe('POST /cash-in idempotency', () => {
  beforeEach(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
    await client.end();
    FakePaymentProvider.reset();
  });

  it('authorizes one provider charge for five concurrent identical requests', async () => {
    const apps = await Promise.all(
      Array.from({ length: 5 }, () => createTestApp()),
    );
    const key = randomUUID();
    const responses = await Promise.all(
      apps.map((app) =>
        request(app.getHttpServer())
          .post('/cash-in')
          .set('Idempotency-Key', key)
          .send({
            user_id: 'usr_abc123',
            amount: '100.00',
            currency: 'pen',
            payment_method: 'fake_pending',
          }),
      ),
    );
    await Promise.all(apps.map((app) => app.close()));

    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(
      new Set(responses.map((response) => response.body.operation_id)).size,
    ).toBe(1);
    expect(FakePaymentProvider.calls()).toBe(1);
  });

  it('rejects an invalid idempotency key and unknown fields', async () => {
    const app = await createTestApp();
    const response = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', 'invalid')
      .send({
        user_id: 'usr',
        amount: '1.00',
        currency: 'PEN',
        payment_method: 'fake_pending',
        extra: true,
      });
    await app.close();
    expect(response.status).toBe(400);
  });
});
