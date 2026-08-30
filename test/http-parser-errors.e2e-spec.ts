import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.ts';
import {
  createHttpTestApp,
  expectParserFailure,
  observeHttpLogs,
} from './http-observability.helpers.ts';

interface ParserErrorCase {
  title: string;
  contentType: string;
  body: string | Record<string, string>;
  statusCode: number;
  label: string;
  errorType: string;
  querySecret: string;
  authorizationSecret: string;
  idempotencyKey?: string;
  secretPattern: RegExp;
}

const PARSER_ERROR_CASES: ParserErrorCase[] = [
  {
    title: 'correlates and logs one sanitized rejection for malformed JSON',
    contentType: 'application/json',
    body: '{"user_id":"parser-body-secret",',
    statusCode: 400,
    label: 'Bad Request',
    errorType: 'BadRequestException',
    querySecret: 'query-secret',
    authorizationSecret: 'secret-authorization',
    idempotencyKey: 'secret-idempotency-key',
    secretPattern:
      /parser-body-secret|query-secret|secret-authorization|secret-idempotency-key|unexpected|json|position|stack/i,
  },
  {
    title: 'preserves and sanitizes an oversized JSON parser rejection',
    contentType: 'application/json',
    body: { payload: 'oversized-body-secret'.repeat(6_000) },
    statusCode: 413,
    label: 'Payload Too Large',
    errorType: 'PayloadTooLargeError',
    querySecret: 'oversized-query-secret',
    authorizationSecret: 'oversized-authorization-secret',
    secretPattern:
      /oversized-body-secret|oversized-query-secret|oversized-authorization-secret|request entity|stack/i,
  },
  {
    title: 'preserves and sanitizes an unsupported JSON charset rejection',
    contentType: 'application/json; charset=unsupported-secret',
    body: '{"value":"charset-body-secret"}',
    statusCode: 415,
    label: 'Unsupported Media Type',
    errorType: 'UnsupportedMediaTypeError',
    querySecret: 'charset-query-secret',
    authorizationSecret: 'charset-authorization-secret',
    secretPattern:
      /unsupported-secret|charset-body-secret|charset-query-secret|charset-authorization-secret|stack/i,
  },
];

describe('HTTP parser error observability', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpTestApp(AppModule);
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(PARSER_ERROR_CASES)('$title', async (testCase) => {
    const correlationId = randomUUID();
    const logs = observeHttpLogs();
    try {
      const parserRequest = request(app.getHttpServer())
        .post(`/cash-in?token=${testCase.querySecret}`)
        .set('content-type', testCase.contentType)
        .set('x-correlation-id', correlationId)
        .set('authorization', testCase.authorizationSecret);
      if (testCase.idempotencyKey) {
        parserRequest.set('idempotency-key', testCase.idempotencyKey);
      }
      const response = await parserRequest
        .send(testCase.body)
        .expect(testCase.statusCode);
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expectParserFailure(response.body, logs.events(), {
        ...testCase,
        correlationId,
      });
      expect(new Date(response.body.timestamp).toISOString()).toBe(
        response.body.timestamp,
      );
      expect(logs.log).not.toHaveBeenCalled();
      expect(logs.warn).toHaveBeenCalledOnce();
      expect(logs.error).not.toHaveBeenCalled();
      expect(JSON.stringify([response.body, logs.messages()])).not.toMatch(
        testCase.secretPattern,
      );
    } finally {
      logs.restore();
    }
  });

  it('replaces an unsafe correlation ID for malformed JSON without exposing it', async () => {
    const unsafeCorrelationId = 'unsafe correlation id secret';
    const logs = observeHttpLogs();
    try {
      const response = await request(app.getHttpServer())
        .post('/cash-in?token=unsafe-query-secret')
        .set('content-type', 'application/json')
        .set('x-correlation-id', unsafeCorrelationId)
        .send('{"amount":"unsafe-parser-body",')
        .expect(400);
      const generatedCorrelationId = response.headers[
        'x-correlation-id'
      ] as string;
      expect(generatedCorrelationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expectParserFailure(response.body, logs.events(), {
        statusCode: 400,
        label: 'Bad Request',
        correlationId: generatedCorrelationId,
        errorType: 'BadRequestException',
      });
      expect(logs.log).not.toHaveBeenCalled();
      expect(logs.warn).toHaveBeenCalledOnce();
      expect(logs.error).not.toHaveBeenCalled();
      expect(
        JSON.stringify([
          generatedCorrelationId,
          response.body,
          logs.messages(),
        ]),
      ).not.toMatch(
        /unsafe correlation id secret|unsafe-parser-body|unsafe-query-secret|unexpected|json|position|stack/i,
      );
    } finally {
      logs.restore();
    }
  });
});
