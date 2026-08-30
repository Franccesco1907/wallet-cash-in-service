import {
  BadRequestException,
  Logger,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  firstValueFrom,
  lastValueFrom,
  NEVER,
  of,
  throwError,
  type Observable,
} from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorrelationContext } from './correlation-context.ts';
import { HttpLoggingInterceptor } from './http-logging.interceptor.ts';

class CashInController {}

function create(): undefined {
  return undefined;
}

function createHttpContext(
  request: Request,
  response: Response,
): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => CashInController,
    getHandler: () => create,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function createRequest(): Request {
  return {
    method: 'POST',
    path: '/cash-in',
    originalUrl: '/cash-in?token=query-secret',
    body: { payment_method: 'secret-payment-method' },
    headers: {
      'idempotency-key': 'secret-idempotency-key',
      authorization: 'secret-authorization',
    },
    query: { token: 'query-secret' },
  } as unknown as Request;
}

function createResponse(statusCode: number): Response {
  return { statusCode } as Response;
}

function createNext(source: Observable<unknown>): CallHandler<unknown> {
  return { handle: vi.fn(() => source) };
}

describe('HttpLoggingInterceptor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through the exact payload and logs safe request lifecycle metadata', async () => {
    const correlation = new CorrelationContext();
    vi.spyOn(correlation, 'getId').mockReturnValue('request-123');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000.2)
      .mockReturnValueOnce(1_025.8);
    const payload = { operation_id: 'operation-123', status: 'completed' };
    const next = createNext(of(payload));
    const context = createHttpContext(createRequest(), createResponse(201));

    const result = await lastValueFrom(
      new HttpLoggingInterceptor(correlation).intercept(context, next),
    );

    expect(result).toBe(payload);
    expect(log.mock.calls).toEqual([
      [
        {
          event: 'http_request_started',
          method: 'POST',
          path: '/cash-in',
          correlation_id: 'request-123',
          controller: 'CashInController',
          handler: 'create',
        },
      ],
      [
        {
          event: 'http_request_completed',
          method: 'POST',
          path: '/cash-in',
          correlation_id: 'request-123',
          controller: 'CashInController',
          handler: 'create',
          status_code: 201,
          duration_ms: 26,
        },
      ],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /query-secret|secret-payment-method|secret-idempotency-key|secret-authorization/,
    );
    expect(next.handle).toHaveBeenCalledOnce();
  });

  it('logs one sanitized rejection event at warn and rethrows the same error', async () => {
    const correlation = new CorrelationContext();
    vi.spyOn(correlation, 'getId').mockReturnValue('rejected-request-456');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(1_999);
    const exception = Object.assign(
      new BadRequestException('payment_method=private'),
      {
        idempotencyKey: 'secret-idempotency-key',
        query: 'token=query-secret',
      },
    );
    const next = createNext(throwError(() => exception));
    const context = createHttpContext(createRequest(), createResponse(200));
    const result = new HttpLoggingInterceptor(correlation).intercept(
      context,
      next,
    );

    await expect(firstValueFrom(result)).rejects.toBe(exception);

    expect(log).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({
      event: 'http_request_rejected',
      method: 'POST',
      path: '/cash-in',
      correlation_id: 'rejected-request-456',
      controller: 'CashInController',
      handler: 'create',
      status_code: 400,
      duration_ms: 0,
      error_type: 'BadRequestException',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /payment_method|private|secret-idempotency-key|query-secret|stack|message/,
    );
    expect(next.handle).toHaveBeenCalledOnce();
  });

  it('owns and logs a synchronous downstream rejection exactly once', async () => {
    const correlation = new CorrelationContext();
    vi.spyOn(correlation, 'getId').mockReturnValue('synchronous-request-456');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(4_001);
    const exception = new BadRequestException('private parser detail');
    const next: CallHandler<unknown> = {
      handle: vi.fn(() => {
        throw exception;
      }),
    };
    const context = createHttpContext(createRequest(), createResponse(200));
    const result = new HttpLoggingInterceptor(correlation).intercept(
      context,
      next,
    );

    await expect(firstValueFrom(result)).rejects.toBe(exception);

    expect(log).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({
      event: 'http_request_rejected',
      method: 'POST',
      path: '/cash-in',
      correlation_id: 'synchronous-request-456',
      controller: 'CashInController',
      handler: 'create',
      status_code: 400,
      duration_ms: 1,
      error_type: 'BadRequestException',
    });
    expect(next.handle).toHaveBeenCalledOnce();
  });

  it('logs one cancellation terminal event on unsubscribe without double subscribing', () => {
    const correlation = new CorrelationContext();
    vi.spyOn(correlation, 'getId').mockReturnValue('cancelled-request-789');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(3_000.1)
      .mockReturnValueOnce(3_002.5);
    const next = createNext(NEVER);
    const result = new HttpLoggingInterceptor(correlation).intercept(
      createHttpContext(createRequest(), createResponse(200)),
      next,
    );

    expect(log).not.toHaveBeenCalled();
    expect(next.handle).not.toHaveBeenCalled();

    const subscription = result.subscribe();
    subscription.unsubscribe();

    expect(log.mock.calls).toEqual([
      [
        {
          event: 'http_request_started',
          method: 'POST',
          path: '/cash-in',
          correlation_id: 'cancelled-request-789',
          controller: 'CashInController',
          handler: 'create',
        },
      ],
      [
        {
          event: 'http_request_cancelled',
          method: 'POST',
          path: '/cash-in',
          correlation_id: 'cancelled-request-789',
          controller: 'CashInController',
          handler: 'create',
          status_code: 200,
          duration_ms: 2,
        },
      ],
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledOnce();
  });

  it('returns the unchanged stream for non-HTTP contexts without logging metadata', () => {
    const correlation = new CorrelationContext();
    const getId = vi.spyOn(correlation, 'getId');
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const source = of({ event: 'message' });
    const next = createNext(source);
    const context = {
      getType: () => 'rpc',
      switchToHttp: () => {
        throw new Error('HTTP metadata must not be accessed');
      },
    } as unknown as ExecutionContext;

    const result = new HttpLoggingInterceptor(correlation).intercept(
      context,
      next,
    );

    expect(result).toBe(source);
    expect(next.handle).toHaveBeenCalledOnce();
    expect(getId).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
