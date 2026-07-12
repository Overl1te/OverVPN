import { hysteria2InboundSettingsSchema } from '@overvpn/shared/schemas';
import { redactAuditData } from '../audit/audit.service';
import { buildHysteria2Storage, buildHysteria2Uri } from './hysteria2-domain';

describe('Hysteria2 domain', () => {
  it('keeps all secret material out of the public database JSON', () => {
    const settings = hysteria2InboundSettingsSchema.parse({
      ...validSettings(),
      obfs: {
        type: 'SALAMANDER',
        password: 'super-private-obfs',
      },
      tls: {
        mode: 'FILES',
        sni: 'vpn.example.com',
        certificatePem: 'PUBLIC CERTIFICATE BODY',
        privateKeyPem: 'PRIVATE KEY BODY',
      },
    });
    const storage = buildHysteria2Storage(settings);
    const publicJson = JSON.stringify(storage.publicConfig);

    expect(publicJson).not.toContain('super-private-obfs');
    expect(publicJson).not.toContain('PUBLIC CERTIFICATE BODY');
    expect(publicJson).not.toContain('PRIVATE KEY BODY');
    expect(publicJson).toContain('"passwordPresent":true');
    expect(publicJson).toContain('"privateKeyPemPresent":true');
    const auditData = JSON.stringify(
      redactAuditData({
        settings,
        macKey: 'super-private-mac-key',
      }),
    );
    expect(auditData).not.toContain('super-private-obfs');
    expect(auditData).not.toContain('PRIVATE KEY BODY');
    expect(auditData).not.toContain('super-private-mac-key');
  });

  it('encodes official Hysteria2 URI components and IPv6 hosts', () => {
    const uri = buildHysteria2Uri({
      password: 'p@ss:/?# ü',
      host: '2001:db8::1',
      port: 8443,
      sni: 'vpn.example.com',
      insecure: true,
      obfsPassword: 'obfs &/secret',
      label: 'Alice / Europe',
    });

    expect(uri).toBe(
      'hysteria2://p%40ss%3A%2F%3F%23%20%C3%BC@[2001:db8::1]:8443/?sni=vpn.example.com&insecure=1&obfs=salamander&obfs-password=obfs%20%26%2Fsecret#Alice%20%2F%20Europe',
    );
  });

  it('rejects unknown and inconsistent inbound settings', () => {
    expect(() =>
      hysteria2InboundSettingsSchema.parse({
        ...validSettings(),
        idleTimeout: '30s',
      }),
    ).toThrow();
    expect(() =>
      hysteria2InboundSettingsSchema.parse({
        ...validSettings(),
        upMbps: 100,
        downMbps: null,
      }),
    ).toThrow();
    expect(() =>
      hysteria2InboundSettingsSchema.parse({
        ...validSettings(),
        tls: {
          mode: 'FILES',
          sni: 'vpn.example.com',
          certificatePath: '/cert.pem',
          unexpected: true,
        },
      }),
    ).toThrow();
  });
});

function validSettings() {
  return {
    listenHost: '0.0.0.0',
    listenPort: 443,
    publicHost: 'vpn.example.com',
    enabled: true,
    upMbps: 100,
    downMbps: 100,
    tls: {
      mode: 'FILES',
      sni: 'vpn.example.com',
      certificatePath: '/var/lib/sing-box/certs/cert.pem',
      keyPath: '/var/lib/sing-box/certs/key.pem',
    },
  };
}
