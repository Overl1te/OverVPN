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
  identityLimitHoldUntil: Date | null;
}

export interface ActiveIdentityCounts {
  devices: number;
}

export interface EnforcedStatus {
  status: UserStatus;
  statusReason: UserStatusReason | null;
}

export interface SessionIdentityRow {
  userId: string;
  deviceId: string | null;
  ipAddress: string | null;
}

export function deviceKeyFromSession(session: {
  deviceId: string | null;
  ipAddress: string | null;
}): string | null {
  return (
    session.deviceId ?? (session.ipAddress ? `ip:${session.ipAddress}` : null)
  );
}

/** Aggregate distinct concurrent devices per user from online session rows. */
export function countIdentitiesByUser(
  sessions: SessionIdentityRow[],
): Map<string, { devices: Set<string> }> {
  const identities = new Map<string, { devices: Set<string> }>();
  for (const session of sessions) {
    const entry = identities.get(session.userId) ?? {
      devices: new Set<string>(),
    };
    const device = deviceKeyFromSession(session);
    if (device) {
      entry.devices.add(device);
    }
    identities.set(session.userId, entry);
  }
  return identities;
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
  if (
    user.status === 'LIMITED' &&
    user.statusReason === 'device' &&
    user.identityLimitHoldUntil !== null &&
    user.identityLimitHoldUntil > now
  ) {
    return {
      status: 'LIMITED',
      statusReason: 'device',
    };
  }
  return { status: 'ACTIVE', statusReason: null };
}

export function nextIdentityLimitHoldUntil(
  enforced: EnforcedStatus,
  overDeviceLimit: boolean,
  holdMs: number,
  now: Date,
  previousHoldUntil: Date | null,
): Date | null {
  if (
    enforced.status === 'LIMITED' &&
    enforced.statusReason === 'device' &&
    overDeviceLimit
  ) {
    return new Date(now.getTime() + holdMs);
  }
  if (enforced.status === 'LIMITED' && enforced.statusReason === 'device') {
    return previousHoldUntil;
  }
  return null;
}

export function nextResetAfterEnforcement(
  strategy: ResetStrategy,
  now: Date,
): Date | null {
  return calculateNextResetAt(strategy, now);
}
