import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ERROR_MESSAGES, type ErrorCode } from '@overvpn/shared/constants';
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

interface ErrorPayload {
  code: string;
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
    const error = this.toPayload(exception, status);
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

  private toPayload(exception: unknown, status: number): ErrorPayload {
    if (exception instanceof ApiException) {
      const messages =
        exception.overrideMessages ??
        ERROR_MESSAGES[exception.code as ErrorCode] ??
        ERROR_MESSAGES.INTERNAL_ERROR;
      return {
        code: exception.code,
        message: messages.en,
        messageRu: messages.ru,
        ...(exception.details === undefined
          ? {}
          : { details: exception.details }),
      };
    }

    const code = this.defaultCode(status);
    const messages = ERROR_MESSAGES[code];
    const details =
      exception instanceof HttpException
        ? this.safeHttpDetails(exception.getResponse())
        : undefined;

    return {
      code,
      message: messages.en,
      messageRu: messages.ru,
      ...(details === undefined ? {} : { details }),
    };
  }

  private safeHttpDetails(response: string | object): unknown {
    if (typeof response === 'string') {
      return undefined;
    }

    const candidate = response as Record<string, unknown>;
    const message = candidate.message;
    return Array.isArray(message) ? { issues: message } : undefined;
  }

  private defaultCode(status: number): ErrorCode {
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
}
