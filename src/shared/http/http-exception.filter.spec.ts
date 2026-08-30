import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorrelationContext } from '../observability/correlation-context.ts';
import { markHttpLifecycleOwned } from '../observability/http-lifecycle.ts';
import { HttpExceptionFilter } from './http-exception.filter.ts';

function createHttpHost(
  path: string,
  headersSent = false,
  method = 'POST',
  correlationIdHeader?: string,
): {
  host: ArgumentsHost;
  request: Request;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
} {
  const request = {
    method,
    originalUrl: `${path}?token=query-secret`,
    path,
    header: vi.fn((name: string) =>
      name.toLowerCase() === 'x-correlation-id'
        ? correlationIdHeader
        : undefined,
    ),
  } as Request;
  const responseDouble = {
    headersSent,
    hasHeader: vi.fn(() => false),
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  responseDouble.status.mockReturnValue(responseDouble);
  const response = responseDouble as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    request,
    status: responseDouble.status,
    json: responseDouble.json,
    setHeader: responseDouble.setHeader,
  };
}

describe('HttpExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a sanitized envelope without terminal lifecycle logging', () => {
    const correlation = new CorrelationContext();
    vi.spyOn(correlation, 'getId').mockReturnValue('filter-request-123');
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { host, request, status, json } = createHttpHost('/private');
    markHttpLifecycleOwned(request);
    const exception = new Error('DATABASE_URL=postgres://secret');

    new HttpExceptionFilter(correlation).catch(exception, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
        path: '/private',
        correlation_id: 'filter-request-123',
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('recovers correlation and logs one sanitized pre-lifecycle rejection', () => {
    const correlation = new CorrelationContext();
    const getId = vi.spyOn(correlation, 'getId');
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { host, status, json, setHeader } = createHttpHost(
      '/cash-in',
      false,
      'POST',
      ' parser-request-123 ',
    );
    const exception = new BadRequestException(
      'Unexpected token parser-body-secret in JSON',
    );

    new HttpExceptionFilter(correlation).catch(exception, host);

    expect(getId).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      'parser-request-123',
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Bad Request',
      error: 'Bad Request',
      path: '/cash-in',
      timestamp: expect.any(String),
      correlation_id: 'parser-request-123',
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith({
      event: 'http_request_rejected',
      method: 'POST',
      path: '/cash-in',
      correlation_id: 'parser-request-123',
      status_code: 400,
      duration_ms: expect.any(Number),
      error_type: 'BadRequestException',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /parser-body-secret|query-secret|unexpected|json|stack|message/i,
    );
  });

  it('does not serialize or log after headers have been sent', () => {
    const correlation = new CorrelationContext();
    const getId = vi
      .spyOn(correlation, 'getId')
      .mockReturnValue('late-request-456');
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const { host, status, json } = createHttpHost('/streaming', true, 'PATCH');
    const exception = Object.assign(
      new Error('late failure DATABASE_URL=postgres://secret'),
      { body: { token: 'secret-body' } },
    );

    new HttpExceptionFilter(correlation).catch(exception, host);

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(getId).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
