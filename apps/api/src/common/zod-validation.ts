import {
  Body,
  HttpStatus,
  Injectable,
  Param,
  PipeTransform,
  Query,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiException } from './api-error';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw new ApiException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
}

export function ZodBody(schema: ZodType): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}

export function ZodQuery(schema: ZodType): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}

export function ZodParam(name: string, schema: ZodType): ParameterDecorator {
  return Param(name, new ZodValidationPipe(schema));
}
