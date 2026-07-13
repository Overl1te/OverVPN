import { InboundCreateValidationPipe } from './inbound-validation.pipe';

describe('InboundCreateValidationPipe', () => {
  it('applies VPN_PUBLIC_HOST before schema validation', () => {
    const pipe = new InboundCreateValidationPipe({
      get: (key: string) => {
        if (key === 'VPN_PUBLIC_HOST') {
          return 'vpn.overl1te-private.online';
        }
        return undefined;
      },
    } as never);

    const result = pipe.transform({
      tag: 'hy2-main',
      protocol: 'HYSTERIA2',
      settings: {
        listenHost: '0.0.0.0',
        listenPort: 443,
        publicHost: '',
        enabled: true,
        upMbps: null,
        downMbps: null,
        ignoreClientBandwidth: false,
        obfs: null,
        tls: {
          mode: 'ACME',
          sni: 'vpn.overl1te-private.online',
          alpn: ['h3'],
          domains: ['vpn.overl1te-private.online'],
          dataDirectory: '/var/lib/sing-box-state/acme',
          provider: 'letsencrypt',
          disableHttpChallenge: false,
          disableTlsAlpnChallenge: false,
          cipherSuites: [],
          curvePreferences: [],
          kernelTx: false,
          kernelRx: false,
          clientInsecure: false,
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
      },
    });

    expect(result.settings.publicHost).toBe('vpn.overl1te-private.online');
  });
});
