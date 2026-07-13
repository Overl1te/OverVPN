import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applyVpnPublicHostFallback } from '@overvpn/shared';
import {
  createInboundSchema,
  updateInboundSchema,
  type CreateInbound,
  type UpdateInbound,
} from '@overvpn/shared/schemas';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';

function validationError(schemaResult: {
  success: false;
  error: {
    issues: Array<{ path: PropertyKey[]; code: string; message: string }>;
  };
}) {
  throw new ApiException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
    issues: schemaResult.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  });
}

@Injectable()
export class InboundCreateValidationPipe implements PipeTransform {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  transform(value: unknown): CreateInbound {
    const vpnHost = this.config.get('VPN_PUBLIC_HOST', { infer: true });
    const patched = applyVpnPublicHostFallback(value, vpnHost);
    const result = createInboundSchema.safeParse(patched);
    if (!result.success) {
      validationError(result);
    }
    return result.data;
  }
}

@Injectable()
export class InboundUpdateValidationPipe implements PipeTransform {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  transform(value: unknown): UpdateInbound {
    const vpnHost = this.config.get('VPN_PUBLIC_HOST', { infer: true });
    const patched = applyVpnPublicHostFallback(value, vpnHost);
    const result = updateInboundSchema.safeParse(patched);
    if (!result.success) {
      validationError(result);
    }
    return result.data;
  }
}
