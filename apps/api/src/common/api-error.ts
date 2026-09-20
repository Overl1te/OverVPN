import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ERROR_MESSAGES,
  errorCatalogEntry,
  errorDocsUrl,
  type ErrorCode,
} from '@overvpn/shared/constants';
import type { Request, Response } from 'express';

export class ApiException extends HttpException {
  constructor(
    readonly code: string,
    status: HttpStatus,
    readonly details?: unknown,
    readonly overrideMessages?: { en: string; ru: string },
  ) {
    super(code, status);
  }
}

export interface ErrorPayload {
  code: string;
  id: string;
  docsUrl: string;
  message: string;
  messageRu: string;
  details?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = toErrorPayload(exception, status);
    const requestId =
      request.id ??
      response.getHeader('X-Request-ID')?.toString() ??
      request.headers['x-request-id']?.toString() ??
      'unknown';

    response.status(status).json({
      error,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}

export function toErrorPayload(
  exception: unknown,
  status: number,
): ErrorPayload {
  if (exception instanceof ApiException) {
    const catalog = errorCatalogEntry(exception.code);
    const messages =
      exception.overrideMessages ??
      ERROR_MESSAGES[exception.code as ErrorCode] ??
      ERROR_MESSAGES.INTERNAL_ERROR;
    return {
      code: exception.code,
      id: catalog.id,
      docsUrl: errorDocsUrl(catalog.id),
      message: messages.en,
      messageRu: messages.ru,
      ...(exception.details === undefined
        ? {}
        : { details: exception.details }),
    };
  }

  const code = defaultErrorCode(status);
  const catalog = errorCatalogEntry(code);
  const messages = ERROR_MESSAGES[code];
  const details =
    exception instanceof HttpException
      ? safeHttpDetails(exception.getResponse())
      : undefined;

  return {
    code,
    id: catalog.id,
    docsUrl: errorDocsUrl(catalog.id),
    message: messages.en,
    messageRu: messages.ru,
    ...(details === undefined ? {} : { details }),
  };
}

function safeHttpDetails(response: string | object): unknown {
  if (typeof response === 'string') {
    return undefined;
  }

  const candidate = response as Record<string, unknown>;
  const message = candidate.message;
  return Array.isArray(message) ? { issues: message } : undefined;
}

function defaultErrorCode(status: number): ErrorCode {
  if (status === 400) {
    return 'VALIDATION_FAILED';
  }
  if (status === 401) {
    return 'AUTH_TOKEN_INVALID';
  }
  if (status === 403) {
    return 'FORBIDDEN';
  }
  if (status === 404) {
    return 'NOT_FOUND';
  }
  if (status === 409) {
    return 'CONFLICT';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  return 'INTERNAL_ERROR';
}
