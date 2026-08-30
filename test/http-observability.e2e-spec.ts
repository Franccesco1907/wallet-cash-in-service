import {
  Controller,
  Get,
  Module,
  Res,
  type INestApplication,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.ts';
import {
  createHttpTestApp,
  expectExactErrorKeys,
  observeHttpLogs,
} from './http-observability.helpers.ts';

@Controller('__test__/http-observability')
class HttpObservabilityProbeController {
  @Get('success')
  succeed(): { status: string } {
    return { status: 'ok' };
  }

  @Get('unknown-error')
  failWithUnknownError(): never {
    throw Object.assign(new Error('DATABASE_URL=postgres://private'), {
      detail: 'duplicate key value violates unique constraint wallets_pkey',
    });
  }

  @Get('late-error')
  failAfterHeaders(@Res() response: Response): never {
    response.status(200).json({ status: 'streamed' });
    throw Object.assign(new Error('payment_method=private'), {
      idempotencyKey: 'secret-idempotency-key',
    });
  }
}

@Module({
  imports: [AppModule],
  controllers: [HttpObservabilityProbeController],
})
class HttpObservabilityTestModule {}

describe('HTTP error observability', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpTestApp(HttpObservabilityTestModule);
  });
  afterAll(async () => {
    await app.close();
  });

  it('applies the global interceptor once to a successful request', async () => {
    const correlationId = 'e2e-observability-success';
    const logs = observeHttpLogs();
    try {
      const response = await request(app.getHttpServer())
        .get('/__test__/http-observability/success?token=query-secret')
        .set('x-correlation-id', correlationId)
        .set('authorization', 'secret-authorization')
        .set('idempotency-key', 'secret-idempotency-key')
        .expect(200);
      const events = logs.events();
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expect(response.body).toEqual({ status: 'ok' });
      expect(events).toEqual([
        {
          event: 'http_request_started',
          method: 'GET',
          path: '/__test__/http-observability/success',
          correlation_id: correlationId,
          controller: 'HttpObservabilityProbeController',
          handler: 'succeed',
        },
        {
          event: 'http_request_completed',
          method: 'GET',
          path: '/__test__/http-observability/success',
          correlation_id: correlationId,
          controller: 'HttpObservabilityProbeController',
          handler: 'succeed',
          status_code: 200,
          duration_ms: expect.any(Number),
        },
      ]);
      expect(events[1]?.['duration_ms']).toBeGreaterThanOrEqual(0);
      expect(logs.log).toHaveBeenCalledTimes(2);
      expect(logs.warn).not.toHaveBeenCalled();
      expect(logs.error).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toMatch(
        /query-secret|secret-authorization|secret-idempotency-key/,
      );
    } finally {
      logs.restore();
    }
  });

  it('returns a stable normalized 400 envelope with matching correlation IDs', async () => {
    const correlationId = 'e2e-observability-400';
    const response = await request(app.getHttpServer())
      .post('/cash-in')
      .set('x-correlation-id', correlationId)
      .set('idempotency-key', randomUUID())
      .send({
        user_id: 42,
        amount: 'invalid',
        currency: 'USD',
        payment_method: [],
      })
      .expect(400);
    expectExactErrorKeys(response.body);
    expect(response.headers['x-correlation-id']).toBe(correlationId);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      path: '/cash-in',
      correlation_id: correlationId,
    });
    expect(response.body.message).toEqual(expect.any(String));
    expect(response.body.message).toContain('; ');
    expect(new Date(response.body.timestamp).toISOString()).toBe(
      response.body.timestamp,
    );
  });

  it('sanitizes an unknown 500 from a test-only endpoint', async () => {
    const correlationId = 'e2e-observability-500';
    const logs = observeHttpLogs();
    try {
      const response = await request(app.getHttpServer())
        .get('/__test__/http-observability/unknown-error?token=query-secret')
        .set('x-correlation-id', correlationId)
        .set('authorization', 'secret-authorization')
        .expect(500);
      const events = logs.events();
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expect(response.body).toMatchObject({
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: '/__test__/http-observability/unknown-error',
        correlation_id: correlationId,
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /private|DATABASE_URL|duplicate key|wallets_pkey/,
      );
      expect(events).toEqual([
        {
          event: 'http_request_started',
          method: 'GET',
          path: '/__test__/http-observability/unknown-error',
          correlation_id: correlationId,
          controller: 'HttpObservabilityProbeController',
          handler: 'failWithUnknownError',
        },
        {
          event: 'http_request_rejected',
          method: 'GET',
          path: '/__test__/http-observability/unknown-error',
          correlation_id: correlationId,
          controller: 'HttpObservabilityProbeController',
          handler: 'failWithUnknownError',
          status_code: 500,
          duration_ms: expect.any(Number),
          error_type: 'Error',
        },
      ]);
      expect(logs.log).toHaveBeenCalledOnce();
      expect(logs.warn).toHaveBeenCalledOnce();
      expect(logs.error).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toMatch(
        /query-secret|secret-authorization|private|DATABASE_URL|duplicate key|wallets_pkey|stack|message/,
      );
    } finally {
      logs.restore();
    }
  });

  it('observes a late headers-sent exception through the global interceptor', async () => {
    const correlationId = 'e2e-observability-late-error';
    const logs = observeHttpLogs();
    try {
      const response = await request(app.getHttpServer())
        .get('/__test__/http-observability/late-error?token=query-secret')
        .set('x-correlation-id', correlationId)
        .expect(200);
      const events = logs.events();
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expect(response.body).toEqual({ status: 'streamed' });
      expect(events).toEqual([
        {
          event: 'http_request_started',
          method: 'GET',
          path: '/__test__/http-observability/late-error',
          correlation_id: correlationId,
          controller: 'HttpObservabilityProbeController',
          handler: 'failAfterHeaders',
        },
        {
          event: 'http_request_rejected',
          method: 'GET',
          path: '/__test__/http-observability/late-error',
          correlation_id: correlationId,
          controller: 'HttpObservabilityProbeController',
          handler: 'failAfterHeaders',
          status_code: 500,
          duration_ms: expect.any(Number),
          error_type: 'Error',
        },
      ]);
      expect(logs.log).toHaveBeenCalledOnce();
      expect(logs.warn).toHaveBeenCalledOnce();
      expect(logs.error).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toMatch(
        /query-secret|payment_method|private|secret-idempotency-key|stack|message/,
      );
    } finally {
      logs.restore();
    }
  });
});
