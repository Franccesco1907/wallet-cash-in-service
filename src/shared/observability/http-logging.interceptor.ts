import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { defer, finalize, tap, type Observable } from 'rxjs';
import { CorrelationContext } from './correlation-context.ts';
import { markHttpLifecycleOwned } from './http-lifecycle.ts';

function resolveErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown';
  return error.constructor.name || 'Error';
}

function resolveErrorStatusCode(error: unknown): number {
  return error instanceof HttpException
    ? error.getStatus()
    : HttpStatus.INTERNAL_SERVER_ERROR;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  constructor(private readonly correlation: CorrelationContext) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    return defer(() => {
      const http = context.switchToHttp();
      const request = http.getRequest<Request>();
      const response = http.getResponse<Response>();
      const correlationId = this.correlation.getId();
      const controller = context.getClass().name;
      const handler = context.getHandler().name;
      const startedAt = performance.now();
      let terminalEventEmitted = false;
      const metadata = {
        method: request.method,
        path: request.path,
        correlation_id: correlationId,
        controller,
        handler,
      };

      markHttpLifecycleOwned(request);
      this.logger.log({ event: 'http_request_started', ...metadata });

      return defer(() => next.handle()).pipe(
        tap({
          complete: () => {
            terminalEventEmitted = true;
            this.logger.log({
              event: 'http_request_completed',
              ...metadata,
              status_code: response.statusCode,
              duration_ms: elapsedMilliseconds(startedAt),
            });
          },
          error: (error: unknown) => {
            terminalEventEmitted = true;
            this.logger.warn({
              event: 'http_request_rejected',
              ...metadata,
              status_code: resolveErrorStatusCode(error),
              duration_ms: elapsedMilliseconds(startedAt),
              error_type: resolveErrorType(error),
            });
          },
        }),
        finalize(() => {
          if (terminalEventEmitted) return;
          this.logger.log({
            event: 'http_request_cancelled',
            ...metadata,
            status_code: response.statusCode,
            duration_ms: elapsedMilliseconds(startedAt),
          });
        }),
      );
    });
  }
}
