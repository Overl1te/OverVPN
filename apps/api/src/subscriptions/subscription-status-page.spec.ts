import type { SubscriptionInfo } from '@overvpn/shared/schemas';
import {
  renderSubscriptionStatusPage,
  resolveSubscriptionPageLocale,
} from './subscription-status-page';

const info: SubscriptionInfo = {
  identity: 'u1',
  username: 'alice',
  status: 'ACTIVE',
  statusReason: null,
  expireAt: '2030-01-01T00:00:00.000Z',
  uploadBytes: '400',
  downloadBytes: '600',
  totalBytes: '1000',
  limitBytes: null,
  remainingBytes: null,
  updateIntervalHours: 24,
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
  subscriptionUrl: 'https://sub.example.com/api/sub/token',
  formats: ['sing-box', 'links', 'clash'],
  formatUrls: {
    singBox: 'https://sub.example.com/api/sub/token?format=sing-box',
    links: 'https://sub.example.com/api/sub/token?format=links',
    clash: 'https://sub.example.com/api/sub/token?format=clash',
  },
};

describe('resolveSubscriptionPageLocale', () => {
  it.each([
    [undefined, 'ru'],
    ['', 'ru'],
    ['en-US,en;q=0.9', 'en'],
    ['ru-RU,ru;q=0.9,en;q=0.8', 'ru'],
    ['de-DE,de;q=0.9,en-US;q=0.8', 'en'],
    ['fr-FR,fr;q=0.9', 'ru'],
    ['en;q=0.4,ru;q=0.8', 'ru'],
  ] as const)('Accept-Language=%j => %s', (header, expected) => {
    expect(resolveSubscriptionPageLocale(header)).toBe(expected);
  });
});

describe('renderSubscriptionStatusPage', () => {
  it('renders Russian copy for Russian Accept-Language', () => {
    const html = renderSubscriptionStatusPage(info, 'ru-RU,ru;q=0.9');
    expect(html).toContain('lang="ru"');
    expect(html).toContain('Статус');
    expect(html).toContain('Активен');
    expect(html).toContain('Без лимита');
    expect(html).toContain('Копировать URL');
    expect(html).toContain('data-locale="ru"');
    expect(html).toContain('overvpn.sub.locale');
  });

  it('renders English copy for English Accept-Language', () => {
    const html = renderSubscriptionStatusPage(info, 'en-US,en;q=0.9');
    expect(html).toContain('lang="en"');
    expect(html).toContain('Status');
    expect(html).toContain('Active');
    expect(html).toContain('Unlimited');
    expect(html).toContain('Copy URL');
  });

  it('embeds both locale packs for client switching', () => {
    const html = renderSubscriptionStatusPage(info, 'en');
    expect(html).toContain('"status":"Status"');
    expect(html).toContain('"status":"Статус"');
    expect(html).toContain('"statusValue":"Active"');
    expect(html).toContain('"statusValue":"Активен"');
  });
});
