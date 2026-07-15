import { type INestApplication, ValidationPipe } from '@nestjs/common';
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
import { prefersSubscriptionHtmlPage } from './subscription-status-page';
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
    // Mirror production: forbidNonWhitelisted must not reject ?format=
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
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

    expect(response.text).toContain('#profile-title:');
    expect(response.text).toContain('#subscription-userinfo:');
    expect(response.text).toContain('hysteria2://usable-link');
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

  it('emits Happ advanced headers and body meta when configured', async () => {
    const branded: typeof info = {
      ...info,
      happProviderId: 'provider-abc',
      subInfoText: 'Telegram-бот',
      subInfoColor: 'blue',
      subInfoButtonText: 'Telegram-бот',
      subInfoButtonLink: 'https://t.me/example',
      subExpireEnabled: true,
      subExpireButtonLink: 'https://t.me/renew',
      fallbackUrl: `https://backup.example.com/api/sub/${TOKEN}`,
      colorProfile: '{"buttonColor":"#9377FFFF"}',
      announce: 'Custom note',
      supportUrl: 'https://t.me/support',
      profileWebPageUrl: 'https://example.com/info',
    };
    service.profile.mockResolvedValueOnce({
      kind: 'ready',
      info: branded,
      profile,
    });

    const response = await request(app.getHttpServer())
      .get(`/api/sub/${TOKEN}?format=links`)
      .expect(200);

    expect(response.headers.providerid).toBe('provider-abc');
    expect(response.headers['sub-info-text']).toBe(
      `base64:${Buffer.from('Telegram-бот').toString('base64')}`,
    );
    expect(response.headers['sub-info-color']).toBe('blue');
    expect(response.headers['sub-expire']).toBe('1');
    expect(response.headers['fallback-url']).toBe(
      `https://backup.example.com/api/sub/${TOKEN}`,
    );
    expect(response.text).toContain('#providerid provider-abc');
    expect(response.text).toContain('#sub-expire: 1');
    expect(response.text).toContain('hysteria2://usable-link');
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
  it('returns an HTML status page for browser requests', async () => {
    builder.render.mockClear();
    service.info.mockClear();
    const response = await request(app.getHttpServer())
      .get(`/api/sub/${TOKEN}`)
      .set('Accept', 'text/html,application/xhtml+xml')
      .set('Accept-Language', 'en-US,en;q=0.9')
      .set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      )
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers.vary).toContain('Accept-Language');
    expect(response.text).toContain('OverVPN');
    expect(response.text).toContain('alice');
    expect(response.text).toContain('Active');
    expect(response.text).toContain(info.formatUrls.links);
    expect(service.info).toHaveBeenCalledWith(TOKEN);
    expect(builder.render).not.toHaveBeenCalled();
  });

  it('localizes the HTML status page from Accept-Language', async () => {
    service.info.mockClear();
    const response = await request(app.getHttpServer())
      .get(`/api/sub/${TOKEN}`)
      .set('Accept', 'text/html')
      .set('Accept-Language', 'ru-RU,ru;q=0.9')
      .set('User-Agent', 'Mozilla/5.0')
      .expect(200);

    expect(response.text).toContain('lang="ru"');
    expect(response.text).toContain('Активен');
    expect(response.text).toContain('Копировать URL');
  });

  it('still returns a profile when a browser asks for an explicit format', async () => {
    builder.render.mockClear();
    const response = await request(app.getHttpServer())
      .get(`/api/sub/${TOKEN}?format=links`)
      .set('Accept', 'text/html')
      .set('User-Agent', 'Mozilla/5.0')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/plain/);
    expect(builder.render).toHaveBeenCalledWith('links', profile);
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
    ['*/*', 'Happ/1.0', 'links'],
    ['*/*', 'HiddifyNext/1.0', 'links'],
    // Real Hiddify desktop UA contains "ClashMeta" — must still get links.
    [
      '*/*',
      'HiddifyNext/4.1.1 (windows) like ClashMeta v2ray sing-box',
      'links',
    ],
    ['*/*', 'nekoray/3', 'links'],
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

describe('subscription HTML preference', () => {
  it.each([
    [undefined, 'text/html', 'Mozilla/5.0', true],
    [undefined, '*/*', 'Mozilla/5.0', true],
    [undefined, '*/*', 'Mihomo/1.0', false],
    ['links', 'text/html', 'Mozilla/5.0', false],
    [undefined, undefined, undefined, false],
  ] as const)(
    'format=%s accept=%s ua=%s => %s',
    (format, accept, ua, expected) => {
      expect(prefersSubscriptionHtmlPage(format, accept, ua)).toBe(expected);
    },
  );
});
