import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface CorrelationStore {
  correlationId: string;
}

@Injectable()
export class CorrelationContext implements NestMiddleware {
  private readonly storage = new AsyncLocalStorage<CorrelationStore>();

  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.header('x-correlation-id');
    const correlationId = header?.trim() || randomUUID();
    response.setHeader('x-correlation-id', correlationId);
    this.storage.run({ correlationId }, next);
  }

  getId(): string {
    return this.storage.getStore()?.correlationId ?? randomUUID();
  }
}
