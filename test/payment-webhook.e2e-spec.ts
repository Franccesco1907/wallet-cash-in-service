import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { FakePaymentProvider } from '../src/cash-in/infrastructure/payment/fake-payment-provider.adapter.js';
import { createTestApp } from './test-app.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wallet:wallet_test@localhost:55432/wallet_cash_in_test';
const secret = process.env.WEBHOOK_SECRET ?? 'local-development-secret';

function signature(raw: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

async function waitForOperation(): Promise<string> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await client.query<{ operation_id: string }>(
      'SELECT operation_id FROM cash_in_operations LIMIT 1',
    );
    if (result.rows[0]) {
      await client.end();
      return result.rows[0].operation_id;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await client.end();
  throw new Error('Operation was not created');
}

describe('POST /webhooks/payment', () => {
  beforeEach(async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      'TRUNCATE provider_events, wallet_ledger, wallets, cash_in_operations CASCADE',
    );
    await client.end();
    FakePaymentProvider.reset();
  });

  it('credits once when a successful webhook arrives twice before the provider response', async () => {
    const app = await createTestApp();
    FakePaymentProvider.holdDelayedResponses();
    const cashInPromise = request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', randomUUID())
      .send({
        user_id: 'usr_webhook',
        amount: 30,
        currency: 'PEN',
        payment_method: 'fake_delayed',
      })
      .then((response) => response);
    const operationId = await waitForOperation();
    const payload = {
      event_id: 'evt_1',
      operation_id: operationId,
      type: 'payment.succeeded',
      sequence: 2,
      provider_payment_id: 'pay_webhook_1',
    };
    const raw = JSON.stringify(payload);
    const first = await request(app.getHttpServer())
      .post('/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature(raw))
      .send(raw);
    const duplicate = await request(app.getHttpServer())
      .post('/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature(raw))
      .send(raw);
    FakePaymentProvider.releaseDelayedResponses();
    const cashIn = await cashInPromise;

    const oldPayload = { ...payload, event_id: 'evt_old', sequence: 1 };
    const oldRaw = JSON.stringify(oldPayload);
    const old = await request(app.getHttpServer())
      .post('/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature(oldRaw))
      .send(oldRaw);
    const invalid = await request(app.getHttpServer())
      .post('/webhooks/payment')
      .send(payload)
      .set('X-Webhook-Signature', 'invalid');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const events = await client.query('SELECT * FROM provider_events');
    const ledger = await client.query('SELECT * FROM wallet_ledger');
    const wallet = await client.query<{ balance_minor: string }>(
      'SELECT balance_minor FROM wallets',
    );
    await client.end();
    await app.close();

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(202);
    expect(old.status).toBe(202);
    expect(invalid.status).toBe(401);
    expect(cashIn.status).toBe(200);
    expect(events.rowCount).toBe(2);
    expect(ledger.rowCount).toBe(1);
    expect(wallet.rows[0]?.balance_minor).toBe('3000');
  });
});
