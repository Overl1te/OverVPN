import type { ConfigService } from '@nestjs/config';
import type { SubscriptionInfo } from '@overvpn/shared/schemas';
import type { ApiException } from '../common/api-error';
import type { AppEnvironment } from '../config/environment';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import type { SubscriptionProfileBuilder } from './subscription-profile';
import {
  buildSubscriptionInfo,
  formatSubscriptionUserinfo,
  SubscriptionsService,
} from './subscriptions.service';

const TOKEN = Buffer.alloc(32, 1).toString('base64url');
const UNKNOWN_TOKEN = Buffer.alloc(32, 2).toString('base64url');

describe('subscription information', () => {
  it('calculates a limited user and exact headers with decimal strings', () => {
    const info = buildSubscriptionInfo(
      {
        identity: 'alice-id',
        username: 'alice',
        status: 'ACTIVE',
        statusReason: null,
        expireAt: new Date('2030-01-01T00:00:00.000Z'),
        dataLimitBytes: 1_000n,
        usedUploadBytes: 400n,
        usedDownloadBytes: 600n,
        plan: null,
      },
      TOKEN,
      'https://vpn.example.com',
      6,
      new Date('2029-01-01T00:00:00.000Z'),
    );

    expect(info).toEqual({
      identity: 'alice-id',
      username: 'alice',
      status: 'LIMITED',
      statusReason: 'quota',
      expireAt: '2030-01-01T00:00:00.000Z',
      uploadBytes: '400',
      downloadBytes: '600',
      totalBytes: '1000',
      limitBytes: '1000',
      remainingBytes: '0',
      updateIntervalHours: 6,
      profileTitle: 'OverVPN - alice',
      announce: null,
      supportUrl: null,
      profileWebPageUrl: null,
      happProviderId: null,
      subInfoText: null,
      subInfoColor: null,
      subInfoButtonText: null,
      subInfoButtonLink: null,
      subExpireEnabled: false,
      subExpireButtonLink: null,
      fallbackUrl: null,
      colorProfile: null,
      showTrafficLimits: true,
      subscriptionUrl: `https://vpn.example.com/api/sub/${TOKEN}`,
      formats: ['sing-box', 'links', 'clash'],
      formatUrls: {
        singBox: `https://vpn.example.com/api/sub/${TOKEN}?format=sing-box`,
        links: `https://vpn.example.com/api/sub/${TOKEN}?format=links`,
        clash: `https://vpn.example.com/api/sub/${TOKEN}?format=clash`,
      },
    });
    expect(formatSubscriptionUserinfo(info)).toBe(
      'upload=400; download=600; total=1000; expire=1893456000',
    );
  });

  it('includes total=0 for unlimited users when showTrafficLimits is enabled', () => {
    const info = buildSubscriptionInfo(
      {
        identity: 'unlimited-id',
        username: 'unlimited',
        status: 'ACTIVE',
        statusReason: null,
        expireAt: null,
        dataLimitBytes: null,
        usedUploadBytes: 12n,
        usedDownloadBytes: 34n,
        plan: null,
      },
      TOKEN,
      'https://vpn.example.com',
      12,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(info).toMatchObject({
      status: 'ACTIVE',
      uploadBytes: '12',
      downloadBytes: '34',
      totalBytes: '46',
      limitBytes: null,
      remainingBytes: null,
      updateIntervalHours: 12,
      showTrafficLimits: true,
    });
    expect(formatSubscriptionUserinfo(info)).toBe(
      'upload=12; download=34; total=0',
    );
  });

  it('omits total when showTrafficLimits is disabled even with a quota', () => {
    const info = buildSubscriptionInfo(
      {
        identity: 'alice-id',
        username: 'alice',
        status: 'ACTIVE',
        statusReason: null,
        expireAt: null,
        dataLimitBytes: 1000n,
        usedUploadBytes: 10n,
        usedDownloadBytes: 20n,
        plan: {
          name: 'Pro',
          subscriptionTitleTemplate: null,
          subscriptionAnnounce: null,
          subscriptionSupportUrl: null,
          subscriptionWebPageUrl: null,
          happProviderId: null,
          subscriptionSubInfoText: null,
          subscriptionSubInfoColor: null,
          subscriptionSubInfoButtonText: null,
          subscriptionSubInfoButtonLink: null,
          subscriptionSubExpireEnabled: false,
          subscriptionSubExpireButtonLink: null,
          subscriptionFallbackUrlTemplate: null,
          subscriptionColorProfile: null,
          subscriptionShowTrafficLimits: false,
        },
      },
      TOKEN,
      'https://vpn.example.com',
      6,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(formatSubscriptionUserinfo(info)).toBe('upload=10; download=20');
  });
});

describe('SubscriptionsService access enforcement', () => {
  let currentUser: ReturnType<typeof userRow> | null;
  let prisma: { user: { findUnique: jest.Mock } };
  let profiles: { build: jest.Mock };
  let queries: CapturedSubscriptionQuery[];
  let service: SubscriptionsService;

  beforeEach(() => {
    currentUser = userRow();
    queries = [];
    prisma = {
      user: {
        findUnique: jest.fn((query: CapturedSubscriptionQuery) => {
          queries.push(query);
          return Promise.resolve(
            currentUser && query.where.subToken === TOKEN ? currentUser : null,
          );
        }),
      },
    };
    profiles = {
      build: jest.fn(() => ({
        title: 'OverVPN - alice',
        identity: 'alice-id',
        username: 'alice',
        endpoints: [
          {
            protocol: 'HYSTERIA2',
            tag: 'hy2-edge',
            displayName: 'alice-id - edge',
            server: 'vpn.example.com',
            port: 443,
            password: 'required-client-password',
            tls: {
              serverName: 'vpn.example.com',
              insecure: false,
              alpn: ['h3'],
            },
            obfs: null,
            bandwidth: { upMbps: 100, downMbps: 100 },
          },
        ],
      })),
    };
    const config = {
      get: jest.fn((key: keyof AppEnvironment) => {
        if (key === 'SUB_PUBLIC_BASE_URL') return 'https://vpn.example.com';
        if (key === 'SUB_PROFILE_UPDATE_INTERVAL_HOURS') return 6;
        throw new Error(`Unexpected config key ${key}`);
      }),
    };
    service = new SubscriptionsService(
      prisma as unknown as PrismaService,
      profiles as unknown as SubscriptionProfileBuilder,
      config as unknown as ConfigService<AppEnvironment, true>,
    );
  });

  it.each([
    {
      label: 'disabled',
      mutate: (user: ReturnType<typeof userRow>) => {
        user.status = 'DISABLED';
        user.statusReason = 'manual';
      },
      expectedStatus: 'DISABLED',
    },
    {
      label: 'expired at request time',
      mutate: (user: ReturnType<typeof userRow>) => {
        user.expireAt = new Date('2025-12-31T23:59:59.000Z');
      },
      expectedStatus: 'EXPIRED',
    },
    {
      label: 'quota limited at request time',
      mutate: (user: ReturnType<typeof userRow>) => {
        user.dataLimitBytes = 100n;
        user.usedUploadBytes = 40n;
        user.usedDownloadBytes = 60n;
      },
      expectedStatus: 'LIMITED',
    },
  ])('does not build usable credentials for $label users', async (testCase) => {
    testCase.mutate(currentUser!);

    const access = await service.profile(
      TOKEN,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(access).toMatchObject({
      kind: 'inactive',
      info: { status: testCase.expectedStatus },
    });
    expect(profiles.build).not.toHaveBeenCalled();
  });

  it('makes malformed and unknown tokens indistinguishable while skipping malformed DB queries', async () => {
    const malformed = await rejection(service.info('not-a-token'));
    expect(queries).toHaveLength(0);

    const unknown = await rejection(service.info(UNKNOWN_TOKEN));
    expect(queries).toHaveLength(1);

    expect({
      code: malformed.code,
      status: malformed.getStatus(),
      details: malformed.details,
    }).toEqual({
      code: unknown.code,
      status: unknown.getStatus(),
      details: unknown.details,
    });
    expect(malformed.code).toBe('SUBSCRIPTION_NOT_FOUND');
    expect(malformed.getStatus()).toBe(404);
  });

  it('uses one exact unique-token query and returns secret-free info', async () => {
    const info = await service.info(TOKEN);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.where).toEqual({ subToken: TOKEN });
    expect(queries[0]?.select).toBeDefined();
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain('credentialEncrypted');
    expect(serialized).not.toContain('secretDataEncrypted');
    expect(serialized).not.toContain('required-client-password');
  });

  it('loads only active assignments attached to enabled inbounds for profiles', async () => {
    await expect(service.profile(TOKEN)).resolves.toMatchObject({
      kind: 'ready',
    });

    const query = queries[0];
    expect(query?.where).toEqual({ subToken: TOKEN });
    expect(query?.select.inboundAssignments?.where).toEqual({
      status: 'ACTIVE',
      inbound: { enabled: true },
    });
  });
});

async function rejection(
  promise: Promise<SubscriptionInfo>,
): Promise<ApiException> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error: unknown) {
    return error as ApiException;
  }
}

interface CapturedSubscriptionQuery {
  where: {
    subToken: string;
  };
  select: {
    inboundAssignments?: {
      where: unknown;
    };
    [key: string]: unknown;
  };
}

function userRow() {
  return {
    id: 'user-id',
    identity: 'alice-id',
    username: 'alice',
    status: 'ACTIVE' as 'ACTIVE' | 'DISABLED' | 'EXPIRED' | 'LIMITED',
    statusReason: null as string | null,
    expireAt: null as Date | null,
    dataLimitBytes: null as bigint | null,
    usedUploadBytes: 10n,
    usedDownloadBytes: 20n,
    deletedAt: null,
    plan: null,
    inboundAssignments: [],
  };
}
