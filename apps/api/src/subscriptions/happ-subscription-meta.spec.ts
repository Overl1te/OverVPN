import type { SubscriptionInfo } from '@overvpn/shared/schemas';
import {
  encodeHappBase64Value,
  formatHappSubscriptionBodyMeta,
  prependHappLinksMeta,
} from './happ-subscription-meta';

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
  announce: 'Note',
  supportUrl: 'https://t.me/support',
  profileWebPageUrl: 'https://example.com',
  happProviderId: 'pid-1',
  subInfoText: 'Hello',
  subInfoColor: 'green',
  subInfoButtonText: 'Open',
  subInfoButtonLink: 'https://t.me/bot',
  subExpireEnabled: true,
  subExpireButtonLink: 'https://t.me/renew',
  fallbackUrl: 'https://backup.example.com/sub/tok',
  colorProfile: '{"buttonColor":"#fff"}',
  showTrafficLimits: true,
  subscriptionUrl: 'https://vpn.example.com/api/sub/tok',
  formats: ['sing-box', 'links', 'clash'],
  formatUrls: {
    singBox: 'https://vpn.example.com/api/sub/tok?format=sing-box',
    links: 'https://vpn.example.com/api/sub/tok?format=links',
    clash: 'https://vpn.example.com/api/sub/tok?format=clash',
  },
};

describe('happ-subscription-meta', () => {
  it('encodes base64 values for Happ headers', () => {
    expect(encodeHappBase64Value('OverVPN')).toBe(
      `base64:${Buffer.from('OverVPN', 'utf8').toString('base64')}`,
    );
  });

  it('builds body meta lines including providerid without a colon', () => {
    const lines = formatHappSubscriptionBodyMeta(info);
    expect(lines).toContain('#providerid pid-1');
    expect(lines).toContain('#sub-expire: 1');
    expect(lines).toContain('#sub-info-color: green');
    expect(lines.some((line) => line.startsWith('#announce:'))).toBe(true);
  });

  it('omits advanced Happ meta when provider id is missing', () => {
    const lines = formatHappSubscriptionBodyMeta({
      ...info,
      happProviderId: null,
    });
    expect(lines.some((line) => line.includes('providerid'))).toBe(false);
    expect(lines.some((line) => line.includes('sub-info'))).toBe(false);
    expect(lines.some((line) => line.includes('sub-expire'))).toBe(false);
    expect(lines.some((line) => line.includes('fallback-url'))).toBe(false);
    expect(lines.some((line) => line.includes('color-profile'))).toBe(false);
  });

  it('prepends meta lines to a links body', () => {
    const body = prependHappLinksMeta('vless://example\n', info);
    expect(body.startsWith('#profile-update-interval: 6\n')).toBe(true);
    expect(body).toContain('vless://example');
  });
});
