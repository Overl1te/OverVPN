import { describe, expect, it } from 'vitest';
import { sanitizeInboundForm } from './InboundEditor';

describe('sanitizeInboundForm', () => {
  const defaults = {
    publicHost: 'vpn.overl1te-private.online',
    acmeHttpPort: 8081,
    acmeTlsPort: 8443,
    singBoxUdpPort: 443,
    singBoxTcpPort: 4443,
    singBoxTrojanPort: 8444,
    singBoxSsPort: 8445,
    xrayListenPort: 9443,
    xrayGrpcPort: 9446,
    xrayTcpTlsPort: 9447,
    tlsCertificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
    tlsKeyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
  };

  it('strips leftover keys from other protocols when saving Hysteria2', () => {
    const sanitized = sanitizeInboundForm(
      {
        tag: 'hy2',
        protocol: 'HYSTERIA2',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 443,
          publicHost: 'vpn.overl1te-private.online',
          enabled: true,
          upMbps: null,
          downMbps: null,
          ignoreClientBandwidth: false,
          obfs: null,
          tls: {
            mode: 'FILES',
            sni: 'vpn.overl1te-private.online',
            alpn: ['h3'],
            minVersion: '1.2',
            cipherSuites: [],
            curvePreferences: [],
            kernelTx: false,
            kernelRx: false,
            clientInsecure: false,
            certificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
            keyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
          },
          masquerade: null,
          bindInterface: null,
          routingMark: null,
          reuseAddr: false,
          netns: null,
          tcpFastOpen: false,
          tcpMultiPath: false,
          disableTcpKeepAlive: false,
          tcpKeepAlive: null,
          tcpKeepAliveInterval: null,
          udpFragment: null,
          udpTimeout: null,
          detour: null,
          brutalDebug: false,
          // leftovers from switching protocols in Ant Design form store
          path: '/',
          host: 'vpn.overl1te-private.online',
          mode: 'auto',
          handshakeServer: 'www.cloudflare.com',
          handshakePort: 443,
          serverNames: ['www.cloudflare.com'],
          shortIds: [''],
          flow: 'xtls-rprx-vision',
          transport: 'none',
          fingerprint: 'chrome',
          fallback: null,
          method: '2022-blake3-aes-256-gcm',
        } as never,
      },
      defaults,
    );

    expect(sanitized.settings).not.toHaveProperty('path');
    expect(sanitized.settings).not.toHaveProperty('host');
    expect(sanitized.settings).not.toHaveProperty('handshakeServer');
    expect(sanitized.settings).not.toHaveProperty('method');
    expect(sanitized.settings).toHaveProperty('tls');
    expect(sanitized.settings).toHaveProperty('upMbps');
  });

  it('strips public-config leftovers (passwordPresent / certificatePemPresent) on edit save', () => {
    const sanitized = sanitizeInboundForm(
      {
        tag: 'poland',
        protocol: 'HYSTERIA2',
        displayNameTemplate: '🇵🇱 OverVPN ПОЛЬША - {protocol}',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 443,
          publicHost: 'vpn.overl1te-private.online',
          publicPort: 443,
          enabled: true,
          upMbps: null,
          downMbps: null,
          ignoreClientBandwidth: false,
          obfs: {
            type: 'SALAMANDER',
            passwordPresent: true,
          },
          tls: {
            mode: 'FILES',
            sni: 'vpn.overl1te-private.online',
            alpn: ['h3'],
            minVersion: '1.2',
            cipherSuites: [],
            curvePreferences: [],
            kernelTx: false,
            kernelRx: false,
            clientInsecure: false,
            certificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
            keyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
            certificatePemPresent: false,
            privateKeyPemPresent: false,
          },
          masquerade: null,
          bindInterface: null,
          routingMark: null,
          reuseAddr: false,
          netns: null,
          tcpFastOpen: false,
          tcpMultiPath: false,
          disableTcpKeepAlive: false,
          tcpKeepAlive: null,
          tcpKeepAliveInterval: null,
          udpFragment: null,
          udpTimeout: null,
          detour: null,
          brutalDebug: false,
        } as never,
      },
      defaults,
    );

    expect(sanitized.settings).toMatchObject({
      obfs: { type: 'SALAMANDER' },
      tls: {
        mode: 'FILES',
        certificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
        keyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
      },
    });
    expect(sanitized.settings.obfs).not.toHaveProperty('passwordPresent');
    expect(sanitized.settings.tls).not.toHaveProperty('certificatePemPresent');
    expect(sanitized.settings.tls).not.toHaveProperty('privateKeyPemPresent');
  });

  it('strips leftover keys when saving Shadowsocks', () => {
    const sanitized = sanitizeInboundForm(
      {
        tag: 'ss',
        protocol: 'SHADOWSOCKS',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 8388,
          publicHost: 'vpn.overl1te-private.online',
          enabled: true,
          method: '2022-blake3-aes-256-gcm',
          upMbps: null,
          path: '/',
          tls: { mode: 'FILES' },
          handshakeServer: 'www.cloudflare.com',
        } as never,
      },
      defaults,
    );

    expect(sanitized.settings).toEqual(
      expect.objectContaining({
        method: '2022-blake3-aes-256-gcm',
        listenPort: 8388,
      }),
    );
    expect(sanitized.settings).not.toHaveProperty('upMbps');
    expect(sanitized.settings).not.toHaveProperty('path');
    expect(sanitized.settings).not.toHaveProperty('tls');
    expect(sanitized.settings).not.toHaveProperty('handshakeServer');
  });

  it('strips public GET leftovers pasted via Advanced JSON (passwordPresent on root secrets)', () => {
    const sanitized = sanitizeInboundForm(
      {
        tag: 'xray',
        protocol: 'VLESS_XHTTP_TLS',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 9443,
          publicHost: 'vpn.overl1te-private.online',
          publicPort: 9443,
          enabled: true,
          path: '/api/v1/update',
          host: 'vpn.overl1te-private.online',
          mode: 'auto',
          tls: {
            mode: 'FILES',
            sni: 'vpn.overl1te-private.online',
            certificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
            keyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
            certificatePemPresent: false,
            privateKeyPemPresent: false,
          },
          // public API shape leftovers
          upMbps: null,
          handshakeServer: 'www.cloudflare.com',
          method: '2022-blake3-aes-256-gcm',
        } as never,
      },
      defaults,
    );

    expect(sanitized.settings).toMatchObject({
      path: '/api/v1/update',
      mode: 'auto',
      tls: {
        mode: 'FILES',
        certificatePath: '/var/lib/sing-box-certs/vpn-fullchain.pem',
        keyPath: '/var/lib/sing-box-certs/vpn-privkey.pem',
      },
    });
    expect(sanitized.settings.tls).not.toHaveProperty('certificatePemPresent');
    expect(sanitized.settings.tls).not.toHaveProperty('privateKeyPemPresent');
    expect(sanitized.settings).not.toHaveProperty('upMbps');
    expect(sanitized.settings).not.toHaveProperty('handshakeServer');
    expect(sanitized.settings).not.toHaveProperty('method');
  });
});
