import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Hysteria2InboundSettings, TrojanInboundSettings } from './schemas.ts';
import { applyVpnPublicHostFallback, buildDefaultInboundSettings } from './inbound-defaults.ts';

describe('buildDefaultInboundSettings', () => {
  it('uses configured public host instead of example.com', () => {
    const settings = buildDefaultInboundSettings('HYSTERIA2', {
      publicHost: 'vpn.overl1te-private.online',
    }) as Hysteria2InboundSettings;
    assert.equal(settings.publicHost, 'vpn.overl1te-private.online');
    assert.equal(settings.tls.sni, 'vpn.overl1te-private.online');
    assert.deepEqual(settings.tls.domains, ['vpn.overl1te-private.online']);
  });

  it('includes alternative ACME ports when they differ from 80/443', () => {
    const settings = buildDefaultInboundSettings('TROJAN', {
      publicHost: 'vpn.example.org',
      acmeHttpPort: 8081,
      acmeTlsPort: 8443,
    }) as TrojanInboundSettings;
    assert.equal(settings.tls.alternativeHttpPort, 8081);
    assert.equal(settings.tls.alternativeTlsPort, 8443);
  });

  it('omits alternative ACME ports on standard 80/443', () => {
    const settings = buildDefaultInboundSettings('HYSTERIA2', {
      publicHost: 'vpn.example.org',
      acmeHttpPort: 80,
      acmeTlsPort: 443,
    }) as Hysteria2InboundSettings;
    assert.equal(settings.tls.alternativeHttpPort, undefined);
    assert.equal(settings.tls.alternativeTlsPort, undefined);
  });

  it('preserves listen overrides when switching presets', () => {
    const settings = buildDefaultInboundSettings(
      'SHADOWSOCKS',
      { publicHost: 'vpn.host.test' },
      {
        listenHost: '127.0.0.1',
        listenPort: 9443,
        publicHost: 'vpn.host.test',
        enabled: false,
      },
    );
    assert.equal(settings.listenHost, '127.0.0.1');
    assert.equal(settings.listenPort, 9443);
    assert.equal(settings.enabled, false);
    assert.equal(settings.publicHost, 'vpn.host.test');
  });

  it('sets a default Let\'s Encrypt contact email from the public host', () => {
    const settings = buildDefaultInboundSettings('HYSTERIA2', {
      publicHost: 'vpn.example.org',
    }) as Hysteria2InboundSettings;
    assert.equal(settings.tls.mode, 'ACME');
    if (settings.tls.mode === 'ACME') {
      assert.equal(settings.tls.email, 'admin@vpn.example.org');
      assert.equal(settings.tls.provider, 'letsencrypt');
    }
  });
});

describe('applyVpnPublicHostFallback', () => {
  it('fills missing publicHost and ACME TLS fields from VPN_PUBLIC_HOST', () => {
    const patched = applyVpnPublicHostFallback(
      {
        tag: 'hy2-main',
        protocol: 'HYSTERIA2',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 443,
          publicHost: '',
          enabled: true,
          tls: {
            mode: 'ACME',
            sni: '',
            domains: [],
            dataDirectory: '/var/lib/sing-box-state/acme',
            provider: 'letsencrypt',
          },
        },
      },
      'vpn.overl1te-private.online',
    ) as {
      settings: {
        publicHost: string;
        tls: { sni: string; domains: string[] };
      };
    };

    assert.equal(patched.settings.publicHost, 'vpn.overl1te-private.online');
    assert.equal(patched.settings.tls.sni, 'vpn.overl1te-private.online');
    assert.deepEqual(patched.settings.tls.domains, ['vpn.overl1te-private.online']);
  });

  it('does not override an explicit publicHost', () => {
    const body = {
      tag: 'hy2-main',
      protocol: 'HYSTERIA2',
      settings: {
        publicHost: 'vpn.custom.test',
      },
    };
    const patched = applyVpnPublicHostFallback(body, 'vpn.overl1te-private.online');
    assert.deepEqual(patched, body);
  });
});
