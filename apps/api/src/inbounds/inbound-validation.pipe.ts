import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  applyVpnPublicHostFallback,
  applyVpnTlsPathsFallback,
} from '@overvpn/shared';
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
}): never {
  throw new ApiException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, {
    issues: schemaResult.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  });
}

function patchInboundBody(
  value: unknown,
  config: ConfigService<AppEnvironment, true>,
): unknown {
  const vpnHost = config.get('VPN_PUBLIC_HOST', { infer: true });
  const withHost = applyVpnPublicHostFallback(value, vpnHost);
  return applyVpnTlsPathsFallback(
    withHost,
    config.get('VPN_TLS_CERTIFICATE_PATH', { infer: true }),
    config.get('VPN_TLS_KEY_PATH', { infer: true }),
  );
}

@Injectable()
export class InboundCreateValidationPipe implements PipeTransform {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  transform(value: unknown): CreateInbound {
    const patched = patchInboundBody(value, this.config);
    const result = createInboundSchema.safeParse(patched);
    if (result.success) {
      return result.data;
    }
    validationError(result);
  }
}

@Injectable()
export class InboundUpdateValidationPipe implements PipeTransform {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  transform(value: unknown): UpdateInbound {
    const patched = patchInboundBody(value, this.config);
    const result = updateInboundSchema.safeParse(patched);
    if (result.success) {
      return result.data;
    }
    validationError(result);
  }
}
