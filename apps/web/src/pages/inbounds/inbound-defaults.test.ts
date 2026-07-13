import { describe, expect, it } from 'vitest';
import { buildDefaultInboundSettings } from '@overvpn/shared';

describe('buildDefaultInboundSettings', () => {
  it('never falls back to vpn.example.com', () => {
    const settings = buildDefaultInboundSettings('HYSTERIA2', {
      publicHost: 'vpn.overl1te-private.online',
      acmeHttpPort: 8081,
      acmeTlsPort: 8443,
    });

    expect(settings.publicHost).toBe('vpn.overl1te-private.online');
    expect(settings.publicHost).not.toBe('vpn.example.com');
    if (settings.tls.mode === 'ACME') {
      expect(settings.tls.sni).toBe('vpn.overl1te-private.online');
      expect(settings.tls.domains).toEqual(['vpn.overl1te-private.online']);
      expect(settings.tls.alternativeHttpPort).toBe(8081);
      expect(settings.tls.alternativeTlsPort).toBe(8443);
    }
  });
});
