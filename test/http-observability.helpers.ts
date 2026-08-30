import {
  Logger,
  ValidationPipe,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { expect, vi } from 'vitest';

export interface HttpEvent extends Record<string, unknown> {
  event: string;
}

export interface ExpectedParserFailure {
  statusCode: number;
  label: string;
  correlationId: string;
  errorType: string;
}

const ERROR_KEYS = [
  'correlation_id',
  'error',
  'message',
  'path',
  'statusCode',
  'timestamp',
];

export async function createHttpTestApp(
  rootModule: Type<unknown>,
): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [rootModule],
  }).compile();
  const app = module.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}

export function observeHttpLogs() {
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const error = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => {});
  const messages = (): unknown[] => [
    ...log.mock.calls.map((call) => call[0]),
    ...warn.mock.calls.map((call) => call[0]),
    ...error.mock.calls.map((call) => call[0]),
  ];
  return {
    log,
    warn,
    error,
    messages,
    events: (): HttpEvent[] => collectHttpEvents(messages()),
    restore: () => {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    },
  };
}

export function collectHttpEvents(messages: unknown[]): HttpEvent[] {
  return messages.filter((message): message is HttpEvent => {
    if (typeof message !== 'object' || message === null) return false;
    const event = (message as Record<string, unknown>)['event'];
    return typeof event === 'string' && event.startsWith('http_');
  });
}

export function expectExactErrorKeys(body: unknown): void {
  expect(Object.keys(body as Record<string, unknown>).sort()).toEqual(
    ERROR_KEYS,
  );
}

export function expectParserFailure(
  body: unknown,
  events: HttpEvent[],
  expected: ExpectedParserFailure,
): void {
  expectExactErrorKeys(body);
  expect(body).toEqual({
    statusCode: expected.statusCode,
    message: expected.label,
    error: expected.label,
    path: '/cash-in',
    timestamp: expect.any(String),
    correlation_id: expected.correlationId,
  });
  expect(events).toEqual([
    {
      event: 'http_request_rejected',
      method: 'POST',
      path: '/cash-in',
      correlation_id: expected.correlationId,
      status_code: expected.statusCode,
      duration_ms: expect.any(Number),
      error_type: expected.errorType,
    },
  ]);
  expect(events[0]?.['duration_ms']).toBeGreaterThanOrEqual(0);
}
