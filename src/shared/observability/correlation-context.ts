import {
  Injectable,
  type NestMiddleware,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface CorrelationStore {
  correlationId: string;
}

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

export function resolveIncomingCorrelationId(
  value: string | undefined,
): string | undefined {
  if (value === undefined || containsControlCharacter(value)) return undefined;
  const trimmed = value.trim();
  return trimmed && SAFE_CORRELATION_ID.test(trimmed) ? trimmed : undefined;
}

@Injectable()
export class CorrelationContext implements NestMiddleware, OnModuleDestroy {
  private readonly storage = new AsyncLocalStorage<CorrelationStore>();

  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.header('x-correlation-id');
    const correlationId = resolveIncomingCorrelationId(header) ?? randomUUID();
    response.setHeader('x-correlation-id', correlationId);
    this.storage.run({ correlationId }, next);
  }

  getId(): string {
    return this.storage.getStore()?.correlationId ?? randomUUID();
  }

  onModuleDestroy(): void {
    this.storage.disable();
  }
}
