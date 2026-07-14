import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SUPPORT_MANIFEST,
  SUPPORT_FINGERPRINT,
  isValidSupportProof,
  supportCanonicalPayload,
  supportSealPayload,
} from '@overvpn/shared/support-integrity';
import { SUPPORT_SEAL } from '@overvpn/shared/support-seal';
import type { Request } from 'express';
import { ApiException } from './api-error';
import { IS_PUBLIC_KEY } from './authorization';

export const SKIP_SUPPORT_INTEGRITY_KEY = 'overvpn:skip-support-integrity';

/** Opt out of the support proof header check (rare; prefer @Public for unauthenticated routes). */
export const SkipSupportIntegrity = () =>
  SetMetadata(SKIP_SUPPORT_INTEGRITY_KEY, true);

@Injectable()
export class SupportIntegrityService implements OnModuleInit {
  private readonly logger = new Logger(SupportIntegrityService.name);
  private intact = false;

  onModuleInit(): void {
    this.intact = this.verifySync();
    if (!this.intact) {
      throw new Error(
        'SUPPORT_INTEGRITY_FAILED: author support manifest fingerprint/seal mismatch',
      );
    }
    this.logger.log(`Support integrity ok (${SUPPORT_MANIFEST.id})`);
  }

  isIntact(): boolean {
    return this.intact && this.verifySync();
  }

  assertIntact(): void {
    if (!this.isIntact()) {
      this.intact = false;
      throw new ApiException(
        'SUPPORT_INTEGRITY_FAILED',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private verifySync(): boolean {
    const fingerprint = createHash('sha256')
      .update(supportCanonicalPayload())
      .digest('hex');
    if (fingerprint !== SUPPORT_FINGERPRINT) {
      return false;
    }
    const seal = createHash('sha256')
      .update(supportSealPayload())
      .digest('hex');
    return seal === SUPPORT_SEAL;
  }
}

@Injectable()
export class SupportIntegrityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly support: SupportIntegrityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const skipped = this.reflector.getAllAndOverride<boolean>(
      SKIP_SUPPORT_INTEGRITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipped) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return true;
    }

    this.support.assertIntact();

    const raw = request.headers[SUPPORT_MANIFEST.headerName];
    const proof = Array.isArray(raw) ? raw[0] : raw;
    if (!proof || !(await isValidSupportProof(proof))) {
      throw new ApiException(
        'SUPPORT_INTEGRITY_FAILED',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return true;
  }
}
