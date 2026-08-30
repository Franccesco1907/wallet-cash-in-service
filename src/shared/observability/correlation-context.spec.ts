import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  CorrelationContext,
  resolveIncomingCorrelationId,
} from './correlation-context.ts';

describe('resolveIncomingCorrelationId', () => {
  it.each([
    'request-123',
    'REQUEST_123',
    'service.instance:request-123',
    'a',
    'a'.repeat(128),
  ])('accepts the safe correlation ID %j', (correlationId) => {
    expect(resolveIncomingCorrelationId(correlationId)).toBe(correlationId);
  });

  it('trims a safe incoming correlation ID', () => {
    expect(resolveIncomingCorrelationId('  request-123  ')).toBe('request-123');
  });

  it.each([
    undefined,
    '',
    '   ',
    'a'.repeat(129),
    'request id',
    'request\tid',
    'request\nid',
    'request\rid',
    '\trequest-id',
    '\nrequest-id',
    'request-id\r\n',
    'request\0id',
    'request\u007fid',
    'request/id',
    'request\\id',
  ])('rejects the unsafe correlation ID %j', (correlationId) => {
    expect(resolveIncomingCorrelationId(correlationId)).toBeUndefined();
  });
});

describe('CorrelationContext', () => {
  it('propagates a valid trimmed client ID and sets the response header', () => {
    const context = new CorrelationContext();
    const request = {
      header: vi.fn().mockReturnValue('  client.request-123  '),
    } as unknown as Request;
    const setHeader = vi.fn();
    const response = { setHeader } as unknown as Response;
    const next: NextFunction = vi.fn(() => {
      expect(context.getId()).toBe('client.request-123');
    });

    context.use(request, response, next);

    expect(setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      'client.request-123',
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates a UUID instead of propagating an unsafe client ID', () => {
    const context = new CorrelationContext();
    const request = {
      header: vi.fn().mockReturnValue('forged\nlog-entry'),
    } as unknown as Request;
    const setHeader = vi.fn();
    const response = { setHeader } as unknown as Response;
    const next: NextFunction = vi.fn(() => {
      expect(context.getId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    context.use(request, response, next);

    const generatedId = setHeader.mock.calls[0]?.[1];
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
