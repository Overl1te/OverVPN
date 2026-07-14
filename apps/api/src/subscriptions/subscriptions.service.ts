import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SUBSCRIPTION_FORMATS,
  buildSubscriptionPublicUrl,
  renderSubscriptionAnnounce,
  renderSubscriptionTitle,
  type UserStatus,
  type UserStatusReason,
} from '@overvpn/shared';
import type {
  SubscriptionInfo,
  SubscriptionProfileDescriptor,
} from '@overvpn/shared/schemas';
import { subscriptionTokenSchema } from '@overvpn/shared/schemas';
import { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/infrastructure.module';
import {
  SubscriptionProfileBuilder,
  type SubscriptionProfileUser,
} from './subscription-profile';

const subscriptionPlanSelect = {
  name: true,
  subscriptionTitleTemplate: true,
  subscriptionAnnounce: true,
  subscriptionSupportUrl: true,
  subscriptionWebPageUrl: true,
} as const;

const subscriptionInfoSelect = {
  id: true,
  identity: true,
  username: true,
  status: true,
  statusReason: true,
  expireAt: true,
  dataLimitBytes: true,
  usedUploadBytes: true,
  usedDownloadBytes: true,
  deletedAt: true,
  plan: { select: subscriptionPlanSelect },
} as const satisfies Prisma.UserSelect;

const subscriptionUserSelect = {
  ...subscriptionInfoSelect,
  inboundAssignments: {
    where: {
      status: 'ACTIVE',
      inbound: {
        enabled: true,
      },
    },
    select: {
      id: true,
      credentialEncrypted: true,
      inbound: {
        select: {
          id: true,
          tag: true,
          protocol: true,
          publicHost: true,
          publicPort: true,
          listenPort: true,
          displayNameTemplate: true,
          config: true,
          secretDataEncrypted: true,
        },
      },
    },
  },
} as const satisfies Prisma.UserSelect;

type SubscriptionInfoRow = Prisma.UserGetPayload<{
  select: typeof subscriptionInfoSelect;
}>;
type SubscriptionUserRow = Prisma.UserGetPayload<{
  select: typeof subscriptionUserSelect;
}>;

export type SubscriptionProfileAccess =
  | {
      kind: 'ready';
      info: SubscriptionInfo;
      profile: SubscriptionProfileDescriptor;
    }
  | {
      kind: 'inactive';
      info: SubscriptionInfo;
    }
  | {
      kind: 'empty';
      info: SubscriptionInfo;
    };

export interface SubscriptionInfoSource {
  identity: string;
  username: string;
  status: UserStatus;
  statusReason: string | null;
  expireAt: Date | null;
  dataLimitBytes: bigint | null;
  usedUploadBytes: bigint;
  usedDownloadBytes: bigint;
  plan: {
    name: string;
    subscriptionTitleTemplate: string | null;
    subscriptionAnnounce: string | null;
    subscriptionSupportUrl: string | null;
    subscriptionWebPageUrl: string | null;
  } | null;
}

@Injectable()
export class SubscriptionsService {
  private readonly publicBaseUrl: string;
  private readonly updateIntervalHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: SubscriptionProfileBuilder,
    config: ConfigService<AppEnvironment, true>,
  ) {
    this.publicBaseUrl = config.get('SUB_PUBLIC_BASE_URL', { infer: true });
    this.updateIntervalHours = config.get('SUB_PROFILE_UPDATE_INTERVAL_HOURS', {
      infer: true,
    });
  }

  async info(token: string, now = new Date()): Promise<SubscriptionInfo> {
    const user = await this.loadInfo(token);
    return buildSubscriptionInfo(
      user,
      token,
      this.publicBaseUrl,
      this.updateIntervalHours,
      now,
    );
  }

  async profile(
    token: string,
    now = new Date(),
  ): Promise<SubscriptionProfileAccess> {
    const user = await this.loadProfile(token);
    const info = buildSubscriptionInfo(
      user,
      token,
      this.publicBaseUrl,
      this.updateIntervalHours,
      now,
    );
    if (info.status !== 'ACTIVE') {
      return { kind: 'inactive', info };
    }

    const profile = this.profiles.build(toProfileUser(user));
    if (profile.endpoints.length === 0) {
      return { kind: 'empty', info };
    }
    return { kind: 'ready', info, profile };
  }

  private async loadInfo(token: string): Promise<SubscriptionInfoRow> {
    this.validateToken(token);
    const user = await this.prisma.user.findUnique({
      where: { subToken: token },
      select: subscriptionInfoSelect,
    });
    if (!user || user.deletedAt !== null) {
      throw notFound();
    }
    return user;
  }

  private async loadProfile(token: string): Promise<SubscriptionUserRow> {
    this.validateToken(token);
    const user = await this.prisma.user.findUnique({
      where: { subToken: token },
      select: subscriptionUserSelect,
    });
    if (!user || user.deletedAt !== null) {
      throw notFound();
    }
    return user;
  }

  private validateToken(token: string): void {
    if (!subscriptionTokenSchema.safeParse(token).success) {
      throw notFound();
    }
  }
}

export function buildSubscriptionInfo(
  source: SubscriptionInfoSource,
  token: string,
  publicBaseUrl: string,
  updateIntervalHours: number,
  now = new Date(),
): SubscriptionInfo {
  const upload = source.usedUploadBytes;
  const download = source.usedDownloadBytes;
  const total = upload + download;
  const remaining =
    source.dataLimitBytes === null
      ? null
      : source.dataLimitBytes > total
        ? source.dataLimitBytes - total
        : 0n;
  const effective = effectiveStatus(source, total, now);
  const subscriptionUrl = buildSubscriptionPublicUrl(publicBaseUrl, token);
  const brandingContext = {
    username: source.username,
    identity: source.identity,
    planName: source.plan?.name ?? null,
    traffic: {
      uploadBytes: upload,
      downloadBytes: download,
      limitBytes: source.dataLimitBytes,
      expireAt: source.expireAt,
      now,
    },
  };

  return {
    identity: source.identity,
    username: source.username,
    status: effective.status,
    statusReason: effective.reason,
    expireAt: source.expireAt?.toISOString() ?? null,
    uploadBytes: upload.toString(),
    downloadBytes: download.toString(),
    totalBytes: total.toString(),
    limitBytes: source.dataLimitBytes?.toString() ?? null,
    remainingBytes: remaining?.toString() ?? null,
    updateIntervalHours,
    profileTitle: renderSubscriptionTitle(
      source.plan?.subscriptionTitleTemplate,
      brandingContext,
    ),
    announce: renderSubscriptionAnnounce(
      source.plan?.subscriptionAnnounce,
      brandingContext,
    ),
    supportUrl: source.plan?.subscriptionSupportUrl ?? null,
    profileWebPageUrl: source.plan?.subscriptionWebPageUrl ?? null,
    subscriptionUrl,
    formats: [...SUBSCRIPTION_FORMATS],
    formatUrls: {
      singBox: `${subscriptionUrl}?format=sing-box`,
      links: `${subscriptionUrl}?format=links`,
      clash: `${subscriptionUrl}?format=clash`,
    },
  };
}

export function formatSubscriptionUserinfo(info: SubscriptionInfo): string {
  return [
    `upload=${info.uploadBytes}`,
    `download=${info.downloadBytes}`,
    ...(info.limitBytes === null ? [] : [`total=${info.limitBytes}`]),
    ...(info.expireAt === null
      ? []
      : [`expire=${Math.floor(new Date(info.expireAt).getTime() / 1_000)}`]),
  ].join('; ');
}

function effectiveStatus(
  source: SubscriptionInfoSource,
  total: bigint,
  now: Date,
): { status: UserStatus; reason: UserStatusReason | null } {
  if (source.status === 'DISABLED') {
    return { status: 'DISABLED', reason: 'manual' };
  }
  if (source.expireAt && source.expireAt <= now) {
    return { status: 'EXPIRED', reason: 'expired' };
  }
  if (source.dataLimitBytes !== null && total >= source.dataLimitBytes) {
    return { status: 'LIMITED', reason: 'quota' };
  }
  if (source.status === 'EXPIRED') {
    return { status: 'EXPIRED', reason: 'expired' };
  }
  if (source.status === 'LIMITED') {
    return {
      status: 'LIMITED',
      reason:
        source.statusReason === 'device' || source.statusReason === 'ip'
          ? source.statusReason
          : 'quota',
    };
  }
  return { status: 'ACTIVE', reason: null };
}

function toProfileUser(user: SubscriptionUserRow): SubscriptionProfileUser {
  return {
    identity: user.identity,
    username: user.username,
    expireAt: user.expireAt,
    dataLimitBytes: user.dataLimitBytes,
    usedUploadBytes: user.usedUploadBytes,
    usedDownloadBytes: user.usedDownloadBytes,
    plan: user.plan
      ? {
          name: user.plan.name,
          subscriptionTitleTemplate: user.plan.subscriptionTitleTemplate,
        }
      : null,
    inboundAssignments: user.inboundAssignments,
  };
}

function notFound(): ApiException {
  return new ApiException('SUBSCRIPTION_NOT_FOUND', HttpStatus.NOT_FOUND);
}
