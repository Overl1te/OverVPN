import {
  shadowsocksInboundSettingsSchema,
  vlessRealityInboundSettingsSchema,
} from '@overvpn/shared/schemas';
import {
  buildShadowsocksUri,
  composeShadowsocksClientPassword,
} from './shadowsocks-domain';
import { buildTrojanUri } from './trojan-domain';
import { buildVlessUri } from './vless-reality-domain';

describe('VLESS Reality domain', () => {
  it('rejects invalid short ids and key pairs', () => {
    expect(() =>
      vlessRealityInboundSettingsSchema.parse({
        listenPort: 443,
        publicHost: 'vpn.example.com',
        handshakeServer: 'www.cloudflare.com',
        serverNames: ['www.cloudflare.com'],
        shortIds: ['abc'],
      }),
    ).toThrow();
    expect(() =>
      vlessRealityInboundSettingsSchema.parse({
        listenPort: 443,
        publicHost: 'vpn.example.com',
        handshakeServer: 'www.cloudflare.com',
        serverNames: ['www.cloudflare.com'],
        shortIds: ['0123456789abcdef'],
        privateKey: 'private-only',
      }),
    ).toThrow();
  });

  it('encodes standard vless:// share links', () => {
    const uri = buildVlessUri({
      uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
      host: 'vpn.example.com',
      port: 443,
      sni: 'www.cloudflare.com',
      fingerprint: 'chrome',
      publicKey: 'public-key-value',
      shortId: '0123456789abcdef',
      flow: 'xtls-rprx-vision',
      label: 'Alice / Edge',
    });

    expect(uri).toBe(
      'vless://7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e@vpn.example.com:443?encryption=none&security=reality&sni=www.cloudflare.com&fp=chrome&pbk=public-key-value&sid=0123456789abcdef&type=tcp&flow=xtls-rprx-vision#Alice%20%2F%20Edge',
    );
  });
});

describe('Trojan domain', () => {
  it('encodes trojan:// links with TLS query params', () => {
    const uri = buildTrojanUri({
      password: 'secret-password',
      host: 'vpn.example.com',
      port: 443,
      sni: 'vpn.example.com',
      insecure: false,
      alpn: ['h2', 'http/1.1'],
      label: 'Alice / Edge',
    });

    expect(uri).toBe(
      'trojan://secret-password@vpn.example.com:443?security=tls&sni=vpn.example.com&allowInsecure=0&alpn=h2%2Chttp%2F1.1&type=tcp#Alice%20%2F%20Edge',
    );
  });
});

describe('Shadowsocks domain', () => {
  it('rejects invalid 2022 server passwords', () => {
    expect(() =>
      shadowsocksInboundSettingsSchema.parse({
        listenPort: 8388,
        publicHost: 'vpn.example.com',
        method: '2022-blake3-aes-128-gcm',
        password: 'too-short',
      }),
    ).toThrow();
  });

  it('composes 2022 client passwords as server:user', () => {
    const serverPassword = Buffer.from('0123456789abcdef').toString('base64');
    const userPassword = Buffer.from('fedcba9876543210').toString('base64');
    expect(
      composeShadowsocksClientPassword(
        '2022-blake3-aes-128-gcm',
        serverPassword,
        userPassword,
      ),
    ).toBe(`${serverPassword}:${userPassword}`);
  });

  it('encodes SIP002 ss:// links', () => {
    const uri = buildShadowsocksUri({
      method: '2022-blake3-aes-256-gcm',
      password: 'server:user',
      host: 'vpn.example.com',
      port: 8388,
      label: 'Alice / Edge',
    });
    expect(uri.startsWith('ss://')).toBe(true);
    expect(uri.endsWith('#Alice%20%2F%20Edge')).toBe(true);
  });
});
