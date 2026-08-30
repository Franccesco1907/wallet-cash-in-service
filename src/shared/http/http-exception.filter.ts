import {
  Catch,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CorrelationContext,
  resolveIncomingCorrelationId,
} from '../observability/correlation-context.ts';
import { isHttpLifecycleOwned } from '../observability/http-lifecycle.ts';
import {
  buildHttpErrorResponse,
  buildSanitizedHttpErrorResponse,
} from './http-error-response.ts';

function resolveErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown';
  return error.constructor.name || 'Error';
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly correlation: CorrelationContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    if (response.headersSent) return;

    const request = http.getRequest<Request>();
    const path = request.path;
    const lifecycleOwned = isHttpLifecycleOwned(request);
    const correlationId =
      resolveIncomingCorrelationId(request.header('x-correlation-id')) ??
      this.correlation.getId();
    if (!response.hasHeader('x-correlation-id')) {
      response.setHeader('x-correlation-id', correlationId);
    }
    const timestamp = new Date().toISOString();
    const errorResponse = lifecycleOwned
      ? buildHttpErrorResponse(exception, path, timestamp, correlationId)
      : buildSanitizedHttpErrorResponse(
          exception,
          path,
          timestamp,
          correlationId,
        );

    if (!lifecycleOwned) {
      this.logger.warn({
        event: 'http_request_rejected',
        method: request.method,
        path,
        correlation_id: correlationId,
        status_code: errorResponse.statusCode,
        duration_ms: 0,
        error_type: resolveErrorType(exception),
      });
    }

    response.status(errorResponse.statusCode).json(errorResponse);
  }
}
