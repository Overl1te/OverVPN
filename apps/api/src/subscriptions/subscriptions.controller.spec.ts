import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SubscriptionInfo } from '@overvpn/shared/schemas';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../common/authorization';
import { SubscriptionProfileBuilder } from './subscription-profile';
import { SubscriptionRateLimitGuard } from './subscription-rate-limit';
import {
  negotiateSubscriptionFormat,
  SubscriptionsController,
} from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

const TOKEN = Buffer.alloc(32, 5).toString('base64url');

describe('SubscriptionsController', () => {
  let app: INestApplication<App>;
  const info: SubscriptionInfo = {
    identity: 'alice-id',
    username: 'alice',
    status: 'ACTIVE',
    statusReason: null,
    expireAt: '2030-01-01T00:00:00.000Z',
    uploadBytes: '400',
    downloadBytes: '600',
    totalBytes: '1000',
    limitBytes: '2000',
    remainingBytes: '1000',
    updateIntervalHours: 6,
    subscriptionUrl: `https://vpn.example.com/api/sub/${TOKEN}`,
    formats: ['sing-box', 'links', 'clash'],
    formatUrls: {
      singBox: `https://vpn.example.com/api/sub/${TOKEN}?format=sing-box`,
      links: `https://vpn.example.com/api/sub/${TOKEN}?format=links`,
      clash: `https://vpn.example.com/api/sub/${TOKEN}?format=clash`,
    },
  };
  const profile = {
    title: 'OverVPN - alice',
    identity: 'alice-id',
    username: 'alice',
    endpoints: [
      {
        protocol: 'HYSTERIA2' as const,
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
        bandwidth: {
          upMbps: 100,
          downMbps: 100,
        },
      },
    ],
  };
  const service = {
    profile: jest.fn().mockResolvedValue({ kind: 'ready', info, profile }),
    info: jest.fn().mockResolvedValue(info),
  };
  const builder = {
    render: jest.fn(() => ({
      body: 'hysteria2://usable-link\n',
      contentType: 'text/plain; charset=utf-8',
      extension: 'txt',
    })),
  };

  beforeAll(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionsService, useValue: service },
        { provide: SubscriptionProfileBuilder, useValue: builder },
      ],
    });
    const moduleRef = await moduleBuilder
      .overrideGuard(SubscriptionRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('is explicitly public and emits exact subscription profile headers', async () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, SubscriptionsController)).toBe(
      true,
    );

    const response = await request(app.getHttpServer())
      .get(`/api/sub/${TOKEN}?format=links`)
      .expect(200);

    expect(response.text).toBe('hysteria2://usable-link\n');
    expect(response.headers['content-type']).toMatch(
      /^text\/plain; charset=utf-8/,
    );
    expect(response.headers['subscription-userinfo']).toBe(
      'upload=400; download=600; total=2000; expire=1893456000',
    );
    expect(response.headers['profile-update-interval']).toBe('6');
    expect(response.headers['profile-title']).toBe(
      `base64:${Buffer.from('OverVPN - alice').toString('base64')}`,
    );
    expect(response.headers['cache-control']).toBe('no-store, max-age=0');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toContain(
      'overvpn-alice.txt',
    );
    expect(builder.render).toHaveBeenCalledWith('links', profile);
  });

  it('returns secret-free status information with subscription headers', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/sub/${TOKEN}/info`)
      .expect(200);

    expect(response.body).toEqual(info);
    expect(response.headers['subscription-userinfo']).toBe(
      'upload=400; download=600; total=2000; expire=1893456000',
    );
    expect(JSON.stringify(response.body)).not.toContain('password');
  });
});

describe('subscription format negotiation', () => {
  it('prioritizes an explicit format', () => {
    expect(
      negotiateSubscriptionFormat('links', 'application/yaml', 'Mihomo/1.0'),
    ).toBe('links');
  });

  it.each([
    ['application/yaml', undefined, 'clash'],
    ['text/plain', undefined, 'links'],
    ['application/json', 'Mihomo/1.0', 'sing-box'],
    ['*/*', 'Mihomo/1.0', 'clash'],
    ['*/*', 'v2rayN/7', 'links'],
    [undefined, undefined, 'sing-box'],
  ] as const)(
    'negotiates Accept=%s User-Agent=%s as %s',
    (accept, userAgent, expected) => {
      expect(negotiateSubscriptionFormat(undefined, accept, userAgent)).toBe(
        expected,
      );
    },
  );
});
