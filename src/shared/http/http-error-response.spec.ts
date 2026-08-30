import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  buildHttpErrorResponse,
  buildSanitizedHttpErrorResponse,
  type HttpErrorResponse,
} from './http-error-response.ts';
const PATH = '/cash-in';
const TIMESTAMP = '2026-08-30T15:00:00.000Z';
const CORRELATION_ID = 'request-123';
const ERROR_CONTEXT = [PATH, TIMESTAMP, CORRELATION_ID] as const;
const RESPONSE_CONTEXT = {
  path: PATH,
  timestamp: TIMESTAMP,
  correlation_id: CORRELATION_ID,
};
interface HttpExceptionCase {
  title: string;
  exception: HttpException;
  expected: Pick<HttpErrorResponse, 'statusCode' | 'message' | 'error'>;
}
function build(exception: unknown): HttpErrorResponse {
  return buildHttpErrorResponse(exception, ...ERROR_CONTEXT);
}
function buildSanitized(exception: unknown): HttpErrorResponse {
  return buildSanitizedHttpErrorResponse(exception, ...ERROR_CONTEXT);
}
function withContext(
  expected: HttpExceptionCase['expected'],
): HttpErrorResponse {
  return { ...expected, ...RESPONSE_CONTEXT };
}
const INTERNAL_ERROR = withContext({
  statusCode: 500,
  message: 'Internal server error',
  error: 'Internal Server Error',
});
const HTTP_EXCEPTION_CASES: HttpExceptionCase[] = [
  {
    title: 'normalizes validation message arrays into one stable string',
    exception: new BadRequestException({
      message: ['amount must be valid', 'currency must be PEN'],
      error: 'Bad Request',
    }),
    expected: {
      statusCode: 400,
      message: 'amount must be valid; currency must be PEN',
      error: 'Bad Request',
    },
  },
  {
    title:
      'uses the status fallback when an array contains only an empty string',
    exception: new BadRequestException({ message: [''], error: 'Bad Request' }),
    expected: { statusCode: 400, message: 'Bad Request', error: 'Bad Request' },
  },
  {
    title:
      'filters invalid and empty entries before joining valid array messages',
    exception: new BadRequestException({
      message: ['', 'amount must be valid', false, 'currency must be PEN', ''],
      error: 'Bad Request',
    }),
    expected: {
      statusCode: 400,
      message: 'amount must be valid; currency must be PEN',
      error: 'Bad Request',
    },
  },
  {
    title: 'normalizes a string HttpException response',
    exception: new HttpException('Public failure', HttpStatus.I_AM_A_TEAPOT),
    expected: {
      statusCode: 418,
      message: 'Public failure',
      error: "I'm a Teapot",
    },
  },
  {
    title: 'normalizes an array HttpException response',
    exception: new HttpException(
      ['first public issue', 'second public issue'],
      HttpStatus.BAD_REQUEST,
    ),
    expected: {
      statusCode: 400,
      message: 'first public issue; second public issue',
      error: 'Bad Request',
    },
  },
  {
    title: 'preserves public fields from an ordinary HttpException object',
    exception: new NotFoundException('Wallet not found'),
    expected: {
      statusCode: 404,
      message: 'Wallet not found',
      error: 'Not Found',
    },
  },
  {
    title: 'falls back safely when an HttpException body is malformed',
    exception: new HttpException(
      { message: { database: 'wallets' }, error: 42 },
      HttpStatus.BAD_REQUEST,
    ),
    expected: { statusCode: 400, message: 'Bad Request', error: 'Bad Request' },
  },
];
describe('buildHttpErrorResponse', () => {
  it.each(HTTP_EXCEPTION_CASES)('$title', ({ exception, expected }) => {
    expect(build(exception)).toEqual(withContext(expected));
  });

  it('sanitizes unknown exceptions without exposing sensitive details', () => {
    const exception = Object.assign(
      new Error('password=secret DATABASE_URL=postgres://private'),
      {
        detail: 'duplicate key value violates unique constraint',
        query: 'SELECT * FROM wallets',
      },
    );
    const response = build(exception);
    expect(response).toEqual(INTERNAL_ERROR);
    expect(JSON.stringify(response)).not.toMatch(
      /secret|DATABASE_URL|duplicate key|SELECT|wallets/,
    );
  });

  it('uses the supplied timestamp, path, and correlation ID unchanged', () => {
    const response = buildHttpErrorResponse(
      new BadRequestException('Invalid request'),
      '/webhooks/payment?source=test',
      '2026-08-30T15:01:02.003Z',
      'correlation.stable-456',
    );
    expect(response.path).toBe('/webhooks/payment?source=test');
    expect(response.timestamp).toBe('2026-08-30T15:01:02.003Z');
    expect(response.correlation_id).toBe('correlation.stable-456');
  });
});

describe('buildSanitizedHttpErrorResponse', () => {
  it.each([
    {
      title: 'status',
      metadata: { status: 413 },
      statusCode: 413,
      label: 'Payload Too Large',
      privateMessage: 'request entity too large secret-body',
      secret: /secret-body|request entity/i,
    },
    {
      title: 'statusCode',
      metadata: { statusCode: 415 },
      statusCode: 415,
      label: 'Unsupported Media Type',
      privateMessage: 'unsupported charset parser-secret',
      secret: /parser-secret|charset/i,
    },
  ])(
    'preserves a trusted integer $title with a canonical sanitized label',
    ({ metadata, statusCode, label, privateMessage, secret }) => {
      const response = buildSanitized(
        Object.assign(new Error(privateMessage), metadata),
      );
      expect(response).toEqual(
        withContext({ statusCode, message: label, error: label }),
      );
      expect(JSON.stringify(response)).not.toMatch(secret);
    },
  );

  it.each([399, 600, 413.5, '413'])(
    'rejects the untrusted status value %j',
    (status) => {
      expect(
        buildSanitized(
          Object.assign(new Error('private parser failure'), { status }),
        ),
      ).toEqual(INTERNAL_ERROR);
    },
  );

  it.each([
    {
      title: 'conflicting trusted status metadata',
      metadata: { status: 413, statusCode: 415 },
    },
    {
      title: 'a valid statusCode paired with an invalid status',
      metadata: { status: '413', statusCode: 413 },
    },
  ])('rejects $title', ({ metadata }) => {
    expect(
      buildSanitized(
        Object.assign(new Error('private parser failure'), metadata),
      ),
    ).toEqual(INTERNAL_ERROR);
  });

  it('does not trust status metadata on a non-Error object', () => {
    expect(
      buildSanitized({
        status: 413,
        message: 'request entity too large private parser detail',
      }),
    ).toEqual(INTERNAL_ERROR);
  });
});
