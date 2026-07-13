import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Hysteria2InboundSettings, TrojanInboundSettings } from './schemas.ts';
import {
  applyVpnPublicHostFallback,
  applyVpnTlsPathsFallback,
  buildDefaultInboundSettings,
} from './inbound-defaults.ts';

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
    assert.equal(settings.tls.mode, 'ACME');
    if (settings.tls.mode === 'ACME') {
      assert.equal(settings.tls.alternativeHttpPort, 8081);
      assert.equal(settings.tls.alternativeTlsPort, 8443);
      assert.equal(settings.tls.disableTlsAlpnChallenge, true);
    }
  });

  it('omits alternative ACME ports on standard 80/443', () => {
    const settings = buildDefaultInboundSettings('HYSTERIA2', {
      publicHost: 'vpn.example.org',
      acmeHttpPort: 80,
      acmeTlsPort: 443,
    }) as Hysteria2InboundSettings;
    assert.equal(settings.tls.mode, 'ACME');
    if (settings.tls.mode === 'ACME') {
      assert.equal(settings.tls.alternativeHttpPort, undefined);
      assert.equal(settings.tls.alternativeTlsPort, undefined);
      assert.equal(settings.tls.disableTlsAlpnChallenge, false);
    }
  });

  it('defaults to FILES TLS when install cert paths are provided', () => {
    const settings = buildDefaultInboundSettings('HYSTERIA2', {
      publicHost: 'vpn.example.org',
      acmeHttpPort: 8081,
      acmeTlsPort: 8443,
      tlsCertificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
      tlsKeyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
    }) as Hysteria2InboundSettings;
    assert.equal(settings.tls.mode, 'FILES');
    if (settings.tls.mode === 'FILES') {
      assert.equal(settings.tls.certificatePath, '/var/lib/sing-box-certs/vpn-fullchain.pem');
      assert.equal(settings.tls.keyPath, '/var/lib/sing-box-certs/vpn-privkey.pem');
      assert.equal(settings.tls.sni, 'vpn.example.org');
    }
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

  it("sets a default Let's Encrypt contact email from the public host", () => {
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

describe('applyVpnTlsPathsFallback', () => {
  it('fills missing VLESS_XHTTP_TLS certificate paths from install defaults', () => {
    const patched = applyVpnTlsPathsFallback(
      {
        tag: 'xhttps',
        protocol: 'VLESS_XHTTP_TLS',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 9443,
          publicHost: 'vpn.overl1te-private.online',
          enabled: true,
          path: '/',
          host: 'vpn.overl1te-private.online',
          mode: 'auto',
          tls: {
            mode: 'FILES',
            sni: 'vpn.overl1te-private.online',
          },
        },
      },
      '/var/lib/sing-box-certs/vpn-fullchain.pem',
      '/var/lib/sing-box-certs/vpn-privkey.pem',
    ) as {
      settings: {
        tls: { certificatePath: string; keyPath: string };
      };
    };

    assert.equal(patched.settings.tls.certificatePath, '/var/lib/sing-box-certs/vpn-fullchain.pem');
    assert.equal(patched.settings.tls.keyPath, '/var/lib/sing-box-certs/vpn-privkey.pem');
  });

  it('does not override inline PEM', () => {
    const body = {
      tag: 'xhttps',
      protocol: 'VLESS_XHTTP_TLS',
      settings: {
        tls: {
          mode: 'FILES',
          sni: 'vpn.test',
          certificatePem: 'CERT',
          privateKeyPem: 'KEY',
        },
      },
    };
    const patched = applyVpnTlsPathsFallback(
      body,
      '/var/lib/sing-box-certs/vpn-fullchain.pem',
      '/var/lib/sing-box-certs/vpn-privkey.pem',
    );
    assert.deepEqual(patched, body);
  });
});
