import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { FakePaymentProvider } from '../src/cash-in/infrastructure/payment/fake-payment-provider.adapter.ts';
import { PROVIDER_RESULT } from '../src/cash-in/application/ports/payment-provider.port.ts';
import { DataSource } from 'typeorm';
import { PostgresCashInStore } from '../src/cash-in/infrastructure/persistence/postgres-cash-in.store.ts';
import { requestFingerprint } from '../src/cash-in/domain/request-fingerprint.ts';
import { createTestApp } from './test-app.ts';

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
      amount: '15.00',
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

  it('translates a thrown provider timeout to awaiting confirmation', async () => {
    const app = await createTestApp();
    const response = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', randomUUID())
      .send({
        user_id: 'usr_throw',
        amount: '10.00',
        currency: 'PEN',
        payment_method: 'fake_throw_timeout',
      });
    await app.close();
    expect(response.status).toBe(202);
    expect(response.body.status).toBe('awaiting_confirmation');
  });

  it('reconciles an uncertain retry without a second charge', async () => {
    const app = await createTestApp();
    const key = randomUUID();
    const body = {
      user_id: 'usr_recovery',
      amount: '25.00',
      currency: 'PEN',
      payment_method: 'fake_timeout',
    };
    const first = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(body);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const operation = await client.query<{
      provider_request_key: string;
      operation_id: string;
    }>('SELECT provider_request_key, operation_id FROM cash_in_operations');
    await client.end();
    FakePaymentProvider.setStatus(operation.rows[0]!.provider_request_key, {
      kind: PROVIDER_RESULT.SUCCESS,
      providerPaymentId: 'pay_reconciled',
      failureCode: null,
    });

    const replay = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send(body);
    await app.close();

    expect(first.body.status).toBe('awaiting_confirmation');
    expect(replay.status).toBe(200);
    expect(replay.body.operation_id).toBe(operation.rows[0]!.operation_id);
    expect(replay.body.status).toBe('completed');
    expect(FakePaymentProvider.calls()).toBe(1);
    expect(FakePaymentProvider.statusCalls()).toBe(1);
  });

  it('recovers a created operation after restart and charges once', async () => {
    const app = await createTestApp();
    const store = new PostgresCashInStore(app.get(DataSource));
    const key = randomUUID();
    const operationId = randomUUID();
    const providerRequestKey = randomUUID();
    await store.createOrGet({
      operationId,
      idempotencyKey: key,
      requestFingerprint: requestFingerprint({
        userId: 'usr_restart',
        amountMinor: 4000n,
        currency: 'PEN',
        paymentMethod: 'fake_success',
      }),
      providerRequestKey,
      userId: 'usr_restart',
      amountMinor: 4000n,
      currency: 'PEN',
      paymentMethod: 'fake_success',
    });
    const replay = await request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send({
        user_id: 'usr_restart',
        amount: '40.00',
        currency: 'PEN',
        payment_method: 'fake_success',
      });
    await app.close();
    expect(replay.status).toBe(200);
    expect(replay.body.operation_id).toBe(operationId);
    expect(FakePaymentProvider.calls()).toBe(1);
  });
});
