import { HttpException, HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

export interface HttpErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  path: string;
  timestamp: string;
  correlation_id: string;
}

interface ErrorWithHttpStatus extends Error {
  status?: unknown;
  statusCode?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asPublicString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asPublicMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return asPublicString(value);
  if (Array.isArray(value)) {
    const messages = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
    return messages.length > 0 ? messages.join('; ') : undefined;
  }
  return undefined;
}

function statusError(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? 'Http Error';
}

function isTrustedHttpErrorStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
  );
}

function resolveTrustedErrorStatus(exception: unknown): number | undefined {
  if (!(exception instanceof Error)) return undefined;

  try {
    const error = exception as ErrorWithHttpStatus;
    const status = error.status;
    const statusCode = error.statusCode;
    if (status !== undefined && !isTrustedHttpErrorStatus(status)) {
      return undefined;
    }
    if (statusCode !== undefined && !isTrustedHttpErrorStatus(statusCode)) {
      return undefined;
    }
    if (
      status !== undefined &&
      statusCode !== undefined &&
      status !== statusCode
    ) {
      return undefined;
    }
    if (isTrustedHttpErrorStatus(status)) return status;
    if (isTrustedHttpErrorStatus(statusCode)) return statusCode;
  } catch {
    return undefined;
  }

  return undefined;
}

function buildSanitizedStatusError(
  statusCode: number,
  path: string,
  timestamp: string,
  correlationId: string,
): HttpErrorResponse {
  const fallback = statusError(statusCode);

  return {
    statusCode,
    message: fallback,
    error: fallback,
    path,
    timestamp,
    correlation_id: correlationId,
  };
}

function buildKnownHttpError(
  exception: HttpException,
  path: string,
  timestamp: string,
  correlationId: string,
): HttpErrorResponse {
  const statusCode = exception.getStatus();
  const fallback = statusError(statusCode);
  const response: unknown = exception.getResponse();
  let message = fallback;
  let error = fallback;

  if (isRecord(response)) {
    message = asPublicMessage(response.message) ?? fallback;
    error = asPublicString(response.error) ?? fallback;
  } else {
    message = asPublicMessage(response) ?? fallback;
  }

  return {
    statusCode,
    message,
    error,
    path,
    timestamp,
    correlation_id: correlationId,
  };
}

export function buildHttpErrorResponse(
  exception: unknown,
  path: string,
  timestamp: string,
  correlationId: string,
): HttpErrorResponse {
  if (exception instanceof HttpException) {
    return buildKnownHttpError(exception, path, timestamp, correlationId);
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
    error: 'Internal Server Error',
    path,
    timestamp,
    correlation_id: correlationId,
  };
}

export function buildSanitizedHttpErrorResponse(
  exception: unknown,
  path: string,
  timestamp: string,
  correlationId: string,
): HttpErrorResponse {
  if (exception instanceof HttpException) {
    return buildSanitizedStatusError(
      exception.getStatus(),
      path,
      timestamp,
      correlationId,
    );
  }

  const statusCode = resolveTrustedErrorStatus(exception);
  if (statusCode !== undefined) {
    return buildSanitizedStatusError(
      statusCode,
      path,
      timestamp,
      correlationId,
    );
  }

  return buildHttpErrorResponse(exception, path, timestamp, correlationId);
}
