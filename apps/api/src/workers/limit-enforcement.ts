import type {
  ResetStrategy,
  UserStatus,
  UserStatusReason,
} from '@overvpn/shared/constants';
import { calculateNextResetAt } from '../users/user-domain';

export interface EnforceableUser {
  status: UserStatus;
  statusReason: string | null;
  expireAt: Date | null;
  dataLimitBytes: bigint | null;
  usedUploadBytes: bigint;
  usedDownloadBytes: bigint;
  deviceLimit: number | null;
  ipLimit: number | null;
}

export interface ActiveIdentityCounts {
  devices: number;
  ips: number;
}

export interface EnforcedStatus {
  status: UserStatus;
  statusReason: UserStatusReason | null;
}

export function evaluateEnforcedStatus(
  user: EnforceableUser,
  active: ActiveIdentityCounts,
  now: Date,
): EnforcedStatus {
  if (user.status === 'DISABLED') {
    return { status: 'DISABLED', statusReason: 'manual' };
  }
  if (user.expireAt && user.expireAt <= now) {
    return { status: 'EXPIRED', statusReason: 'expired' };
  }
  if (
    user.dataLimitBytes !== null &&
    user.usedUploadBytes + user.usedDownloadBytes >= user.dataLimitBytes
  ) {
    return { status: 'LIMITED', statusReason: 'quota' };
  }
  if (user.deviceLimit !== null && active.devices > user.deviceLimit) {
    return { status: 'LIMITED', statusReason: 'device' };
  }
  if (user.ipLimit !== null && active.ips > user.ipLimit) {
    return { status: 'LIMITED', statusReason: 'ip' };
  }
  return { status: 'ACTIVE', statusReason: null };
}

export function nextResetAfterEnforcement(
  strategy: ResetStrategy,
  now: Date,
): Date | null {
  return calculateNextResetAt(strategy, now);
}
