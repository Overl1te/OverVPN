import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTemplateBytes,
  formatTrafficBar,
  renderEndpointDisplayName,
  renderSubscriptionAnnounce,
  renderSubscriptionFallbackUrl,
  renderSubscriptionSubInfoText,
  renderSubscriptionTitle,
  uniquifyDisplayNames,
} from '../dist/subscription-templates.js';

describe('subscription-templates', () => {
  it('renders default subscription title', () => {
    assert.equal(
      renderSubscriptionTitle(null, {
        username: 'alice',
        identity: 'alice-id',
      }),
      'OverVPN - alice',
    );
  });

  it('renders custom subscription title with emoji and traffic vars', () => {
    assert.equal(
      renderSubscriptionTitle('🚀 {plan} · {username} · {used}/{limit}', {
        username: 'bob',
        identity: 'bob-id',
        planName: 'Premium',
        traffic: {
          uploadBytes: 50n * 1024n * 1024n,
          downloadBytes: 50n * 1024n * 1024n,
          limitBytes: 1024n * 1024n * 1024n,
          expireAt: null,
        },
      }),
      '🚀 Premium · bob · 100MB/1.00GB',
    );
  });

  it('replaces unknown tokens with empty string', () => {
    assert.equal(
      renderSubscriptionTitle('Hi {username}{unknown}', {
        username: 'carol',
        identity: 'carol-id',
      }),
      'Hi carol',
    );
  });

  it('renders announce and returns null when empty', () => {
    assert.equal(
      renderSubscriptionAnnounce('До {expire}', {
        username: 'alice',
        identity: 'alice-id',
        traffic: {
          uploadBytes: 0n,
          downloadBytes: 0n,
          limitBytes: null,
          expireAt: new Date('2027-01-30T00:00:00.000Z'),
        },
      }),
      'До 30.01.2027',
    );
    assert.equal(
      renderSubscriptionAnnounce('  ', {
        username: 'alice',
        identity: 'alice-id',
      }),
      null,
    );
  });

  it('renders sub-info text and fallback URL templates', () => {
    assert.equal(
      renderSubscriptionSubInfoText('Осталось дней: {expireDays}', {
        username: 'alice',
        identity: 'alice-id',
        traffic: {
          uploadBytes: 0n,
          downloadBytes: 0n,
          limitBytes: null,
          expireAt: new Date('2027-01-30T00:00:00.000Z'),
          now: new Date('2027-01-19T00:00:00.000Z'),
        },
      }),
      'Осталось дней: 11',
    );
    assert.equal(
      renderSubscriptionFallbackUrl('https://backup.example.com/api/sub/{token}', {
        username: 'alice',
        identity: 'alice-id',
        token: 'tok123',
        subscriptionUrl: 'https://primary.example.com/api/sub/tok123',
      }),
      'https://backup.example.com/api/sub/tok123',
    );
    assert.equal(
      renderSubscriptionFallbackUrl(null, {
        username: 'alice',
        identity: 'alice-id',
      }),
      null,
    );
  });

  it('renders default and custom endpoint display names', () => {
    assert.equal(
      renderEndpointDisplayName(null, {
        username: 'alice',
        identity: 'alice',
        tag: 'edge',
        protocol: 'HYSTERIA2',
      }),
      'alice - edge',
    );
    assert.equal(
      renderEndpointDisplayName('🇩🇪 {tag} · {protocol}', {
        username: 'alice',
        identity: 'alice',
        tag: 'fra',
        protocol: 'HYSTERIA2',
      }),
      '🇩🇪 fra · Hysteria2',
    );
    assert.equal(
      renderEndpointDisplayName('🇵🇱 Overl1te VPN Польша · {protocol}', {
        username: 'alice',
        identity: 'alice',
        tag: 'test2',
        protocol: 'VLESS_XHTTP_TLS',
      }),
      '🇵🇱 Overl1te VPN Польша · XHTTP',
    );
    assert.equal(
      renderEndpointDisplayName('{protocol}', {
        username: 'alice',
        identity: 'alice',
        tag: 'test3',
        protocol: 'VLESS_REALITY',
      }),
      'Reality',
    );
  });

  it('formats bytes and traffic bars', () => {
    assert.equal(formatTemplateBytes(null), '∞');
    assert.equal(formatTemplateBytes(512n), '512B');
    assert.equal(formatTrafficBar(50n, 100n, 10), '▓▓▓▓▓░░░░░');
    assert.match(formatTrafficBar(0n, null, 10), /^▓+░+$/);
  });

  it('uniquifies colliding display names', () => {
    assert.deepEqual(uniquifyDisplayNames(['EU', 'EU', 'US', 'EU']), [
      'EU',
      'EU #2',
      'US',
      'EU #3',
    ]);
  });
});
