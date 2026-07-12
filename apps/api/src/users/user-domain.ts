import { randomBytes } from 'node:crypto';
import type {
  ResetStrategy,
  UserStatus,
  UserStatusReason,
} from '@overvpn/shared/constants';

export interface UserStateForStatus {
  expireAt: Date | null;
  dataLimitBytes: bigint | null;
  usedUploadBytes: bigint;
  usedDownloadBytes: bigint;
}

export interface NormalizedUserStatus {
  status: UserStatus;
  statusReason: UserStatusReason | null;
  disabledAt: Date | null;
}

export function normalizeUserStatus(
  state: UserStateForStatus,
  requestedStatus: UserStatus | undefined,
  requestedReason: UserStatusReason | null | undefined,
  now = new Date(),
): NormalizedUserStatus {
  if (requestedStatus === 'DISABLED') {
    return { status: 'DISABLED', statusReason: 'manual', disabledAt: now };
  }
  if (requestedStatus === 'EXPIRED') {
    return { status: 'EXPIRED', statusReason: 'expired', disabledAt: null };
  }
  if (requestedStatus === 'LIMITED') {
    return {
      status: 'LIMITED',
      statusReason:
        requestedReason === 'device' || requestedReason === 'ip'
          ? requestedReason
          : 'quota',
      disabledAt: null,
    };
  }
  if (state.expireAt && state.expireAt <= now) {
    return { status: 'EXPIRED', statusReason: 'expired', disabledAt: null };
  }
  if (
    state.dataLimitBytes !== null &&
    state.usedUploadBytes + state.usedDownloadBytes >= state.dataLimitBytes
  ) {
    return { status: 'LIMITED', statusReason: 'quota', disabledAt: null };
  }
  return { status: 'ACTIVE', statusReason: null, disabledAt: null };
}

export function calculateNextResetAt(
  strategy: ResetStrategy,
  from = new Date(),
): Date | null {
  if (strategy === 'NO_RESET') {
    return null;
  }
  if (strategy === 'DAILY') {
    return new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + 1,
      ),
    );
  }
  if (strategy === 'MONTHLY') {
    return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  }
  return new Date(Date.UTC(from.getUTCFullYear() + 1, 0, 1));
}

export function createSubscriptionToken(): string {
  return randomBytes(32).toString('base64url');
}
