import { parse as parseYaml } from 'yaml';
import type { SecretEncryptionService } from '../auth/auth-crypto';
import {
  Hysteria2SubscriptionAdapter,
  ShadowsocksSubscriptionAdapter,
  SubscriptionProfileBuilder,
  TrojanSubscriptionAdapter,
  VlessGrpcTlsSubscriptionAdapter,
  VlessRealitySubscriptionAdapter,
  VlessTcpTlsSubscriptionAdapter,
  VlessXhttpTlsSubscriptionAdapter,
  renderClashProfile,
  renderLinkList,
  renderSingBoxProfile,
  type SubscriptionProfileUser,
} from './subscription-profile';

function createBuilder(
  encryption: SecretEncryptionService,
): SubscriptionProfileBuilder {
  return new SubscriptionProfileBuilder(
    new Hysteria2SubscriptionAdapter(encryption),
    new VlessRealitySubscriptionAdapter(encryption),
    new VlessXhttpTlsSubscriptionAdapter(encryption),
    new VlessGrpcTlsSubscriptionAdapter(encryption),
    new VlessTcpTlsSubscriptionAdapter(encryption),
    new TrojanSubscriptionAdapter(encryption),
    new ShadowsocksSubscriptionAdapter(encryption),
  );
}

describe('SubscriptionProfileBuilder', () => {
  let builder: SubscriptionProfileBuilder;
  let profile: ReturnType<SubscriptionProfileBuilder['build']>;

  beforeEach(() => {
    const encryption = {
      decrypt: jest.fn((payload: string) => {
        if (payload === 'v1:credential-envelope') {
          return JSON.stringify({
            version: 1,
            password: 'p@ssword /?# ü',
          });
        }
        if (payload === 'inbound-secret-envelope') {
          return JSON.stringify({
            version: 1,
            obfsPassword: 'obfs &/secret',
            privateKeyPem: 'PRIVATE KEY MUST NEVER LEAK',
            certificatePem: 'CERTIFICATE MUST NEVER LEAK',
          });
        }
        throw new Error('Unknown encrypted fixture');
      }),
    };
    builder = createBuilder(encryption as unknown as SecretEncryptionService);
    profile = builder.build(profileUser());
  });

  it('renders a deterministic current sing-box profile without internal secrets', () => {
    const first = renderSingBoxProfile(profile);
    const second = renderSingBoxProfile(profile);
    const parsed = JSON.parse(first) as {
      outbounds: Array<Record<string, unknown>>;
      dns: Record<string, unknown>;
      route: Record<string, unknown>;
      inbounds: Array<Record<string, unknown>>;
    };
    const proxy = parsed.outbounds.find(
      (outbound) => outbound.type === 'hysteria2',
    );

    expect(first).toBe(second);
    expect(proxy).toEqual({
      type: 'hysteria2',
      tag: 'Alice / Europe - Edge_EU',
      server: 'vpn.example.com',
      server_port: 8443,
      password: 'p@ssword /?# ü',
      up_mbps: 100,
      down_mbps: 300,
      obfs: {
        type: 'salamander',
        password: 'obfs &/secret',
      },
      tls: {
        enabled: true,
        server_name: 'vpn.example.com',
        insecure: false,
        alpn: ['h3'],
      },
    });
    expect(parsed.outbounds[0]).toMatchObject({
      type: 'selector',
      tag: 'select',
      default: 'auto',
    });
    expect(parsed.outbounds[1]).toMatchObject({
      type: 'urltest',
      tag: 'auto',
      outbounds: ['Alice / Europe - Edge_EU'],
    });
    expect(parsed.inbounds[0]).toMatchObject({
      type: 'tun',
      auto_route: true,
      strict_route: true,
    });
    expect(parsed.dns).toMatchObject({ final: 'remote' });
    expect(parsed.route).toMatchObject({
      final: 'select',
      auto_detect_interface: true,
    });

    expect(first).toContain('p@ssword /?# ü');
    expect(first).toContain('obfs &/secret');
    expect(first).not.toContain('PRIVATE KEY MUST NEVER LEAK');
    expect(first).not.toContain('CERTIFICATE MUST NEVER LEAK');
    expect(first).not.toContain('credential-envelope');
    expect(first).not.toContain('assignment-id');
    expect(first).not.toContain('inbound-id');
    expect(first).not.toContain('credentialVersion');
  });

  it('renders the exact tested Hysteria2 share-link payload', () => {
    expect(renderLinkList(profile)).toBe(
      'hysteria2://p%40ssword%20%2F%3F%23%20%C3%BC@vpn.example.com:8443/?sni=vpn.example.com&insecure=0&obfs=salamander&obfs-password=obfs%20%26%2Fsecret#Alice%20%2F%20Europe%20-%20Edge_EU\n',
    );
  });

  it('serializes parseable Mihomo YAML with HY2 fields and groups', () => {
    const yaml = renderClashProfile(profile);
    const parsed = parseYaml(yaml) as {
      proxies: Array<Record<string, unknown>>;
      'proxy-groups': Array<Record<string, unknown>>;
      rules: string[];
      dns: Record<string, unknown>;
    };

    expect(yaml).not.toContain('&a');
    expect(yaml).not.toContain('*a');
    expect(parsed.proxies).toEqual([
      {
        name: 'Alice / Europe - Edge_EU',
        type: 'hysteria2',
        server: 'vpn.example.com',
        port: 8443,
        password: 'p@ssword /?# ü',
        sni: 'vpn.example.com',
        'skip-cert-verify': false,
        alpn: ['h3'],
        obfs: 'salamander',
        'obfs-password': 'obfs &/secret',
        up: '100 Mbps',
        down: '300 Mbps',
      },
    ]);
    expect(parsed['proxy-groups']).toEqual([
      {
        name: 'PROXY',
        type: 'select',
        proxies: ['AUTO', 'Alice / Europe - Edge_EU', 'DIRECT'],
      },
      {
        name: 'AUTO',
        type: 'url-test',
        proxies: ['Alice / Europe - Edge_EU'],
        url: 'https://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 50,
      },
    ]);
    expect(parsed.rules).toEqual(['MATCH,PROXY']);
    expect(parsed.dns).toMatchObject({
      enable: true,
      'enhanced-mode': 'fake-ip',
    });
    expect(yaml).not.toContain('PRIVATE KEY MUST NEVER LEAK');
    expect(yaml).not.toContain('inbound-secret-envelope');
  });

  it('includes mixed protocol endpoints in subscription payloads', () => {
    const mixedUser = profileUser();
    mixedUser.inboundAssignments.push(
      {
        id: 'assignment-vless',
        credentialEncrypted: 'v1:vless-credential',
        inbound: {
          id: 'inbound-vless',
          tag: 'Edge_VLESS',
          protocol: 'VLESS_REALITY',
          publicHost: 'vpn.example.com',
          publicPort: 9443,
          listenPort: 9443,
          displayNameTemplate: null,
          config: {
            handshakeServer: 'www.cloudflare.com',
            handshakePort: 443,
            serverNames: ['www.cloudflare.com'],
            shortIds: ['0123456789abcdef'],
            flow: 'xtls-rprx-vision',
            transport: 'none',
            fingerprint: 'chrome',
            publicKeyPresent: true,
            privateKeyPresent: true,
          },
          secretDataEncrypted: 'vless-secret-envelope',
        },
      },
      {
        id: 'assignment-ss',
        credentialEncrypted: 'v1:ss-credential',
        inbound: {
          id: 'inbound-ss',
          tag: 'Edge_SS',
          protocol: 'SHADOWSOCKS',
          publicHost: 'vpn.example.com',
          publicPort: 8388,
          listenPort: 8388,
          displayNameTemplate: null,
          config: {
            method: '2022-blake3-aes-256-gcm',
            passwordPresent: true,
          },
          secretDataEncrypted: 'ss-secret-envelope',
        },
      },
    );

    const encryption = {
      decrypt: jest.fn((payload: string) => {
        if (payload === 'v1:credential-envelope') {
          return JSON.stringify({
            version: 1,
            password: 'p@ssword /?# ü',
          });
        }
        if (payload === 'v1:vless-credential') {
          return JSON.stringify({
            version: 1,
            uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
          });
        }
        if (payload === 'v1:ss-credential') {
          return JSON.stringify({
            version: 1,
            password: Buffer.alloc(32, 7).toString('base64'),
          });
        }
        if (payload === 'inbound-secret-envelope') {
          return JSON.stringify({
            version: 1,
            obfsPassword: 'obfs &/secret',
          });
        }
        if (payload === 'vless-secret-envelope') {
          return JSON.stringify({
            version: 1,
            privateKey: 'PRIVATE',
            publicKey: 'PUBLIC-KEY',
          });
        }
        if (payload === 'ss-secret-envelope') {
          return JSON.stringify({
            version: 1,
            serverPassword: Buffer.alloc(32, 3).toString('base64'),
          });
        }
        throw new Error('Unknown encrypted fixture');
      }),
    };
    const mixedBuilder = createBuilder(
      encryption as unknown as SecretEncryptionService,
    );
    const mixedProfile = mixedBuilder.build(mixedUser);
    const links = renderLinkList(mixedProfile).trim().split('\n');
    const yaml = renderClashProfile(mixedProfile);
    const parsedYaml = parseYaml(yaml) as { proxies: Array<{ type: string }> };

    expect(mixedProfile.endpoints).toHaveLength(3);
    expect(links).toHaveLength(3);
    expect(links[0]?.startsWith('hysteria2://')).toBe(true);
    expect(links[1]?.startsWith('ss://')).toBe(true);
    expect(links[2]?.startsWith('vless://')).toBe(true);
    expect(parsedYaml.proxies.map((proxy) => proxy.type)).toEqual([
      'hysteria2',
      'ss',
      'vless',
    ]);
  });

  it('resolves normalized tag collisions deterministically', () => {
    const user = profileUser();
    user.inboundAssignments.push({
      ...user.inboundAssignments[0],
      id: 'assignment-id-2',
      inbound: {
        ...user.inboundAssignments[0].inbound,
        id: 'inbound-id-2',
        tag: 'edge_eu',
      },
    });

    expect(
      builder.build(user).endpoints.map((endpoint) => endpoint.tag),
    ).toEqual(['hy2-edge_eu', 'hy2-edge_eu-2']);
  });

  it('builds VLESS_XHTTP_TLS share links and warns about sing-box omission', () => {
    const encryption = {
      decrypt: jest.fn((payload: string) => {
        if (payload === 'v1:xhttp-credential') {
          return JSON.stringify({
            version: 1,
            uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
          });
        }
        throw new Error('Unknown encrypted fixture');
      }),
    };
    const xhttpBuilder = createBuilder(
      encryption as unknown as SecretEncryptionService,
    );
    const user: SubscriptionProfileUser = {
      identity: 'Bob',
      username: 'bob',
      expireAt: null,
      dataLimitBytes: null,
      usedUploadBytes: 0n,
      usedDownloadBytes: 0n,
      plan: null,
      inboundAssignments: [
        {
          id: 'assignment-xhttp',
          credentialEncrypted: 'v1:xhttp-credential',
          inbound: {
            id: 'inbound-xhttp',
            tag: 'Edge_XHTTP',
            protocol: 'VLESS_XHTTP_TLS',
            publicHost: 'vpn.example.com',
            publicPort: 443,
            listenPort: 443,
            displayNameTemplate: null,
            config: {
              path: '/api/v1/ws',
              host: 'cdn.example.com',
              mode: 'auto',
              tls: {
                mode: 'FILES',
                sni: 'vpn.example.com',
                certificatePath: '/cert.pem',
                keyPath: '/key.pem',
                certificatePemPresent: false,
                privateKeyPemPresent: false,
              },
            },
            secretDataEncrypted: null,
          },
        },
      ],
    };

    const xhttpProfile = xhttpBuilder.build(user);
    const links = renderLinkList(xhttpProfile).trim();
    const singBox = JSON.parse(renderSingBoxProfile(xhttpProfile)) as {
      outbounds: Array<{ type: string; tag: string }>;
    };
    const clash = parseYaml(renderClashProfile(xhttpProfile)) as {
      proxies: Array<Record<string, unknown>>;
    };

    expect(xhttpProfile.warnings).toEqual([
      'VLESS_XHTTP_TLS endpoints are omitted from sing-box client profiles (xHTTP outbound is not included)',
    ]);
    expect(links).toBe(
      'vless://7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e@vpn.example.com:443?encryption=none&security=tls&type=xhttp&path=%2Fapi%2Fv1%2Fws&host=cdn.example.com&sni=vpn.example.com&fp=chrome&mode=auto#Bob%20-%20Edge_XHTTP',
    );
    expect(
      singBox.outbounds.filter((outbound) => outbound.type === 'vless'),
    ).toEqual([]);
    expect(clash.proxies).toEqual([
      {
        name: 'Bob - Edge_XHTTP',
        type: 'vless',
        server: 'vpn.example.com',
        port: 443,
        uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
        network: 'xhttp',
        tls: true,
        udp: true,
        'client-fingerprint': 'chrome',
        servername: 'vpn.example.com',
        'xhttp-opts': {
          path: '/api/v1/ws',
          mode: 'auto',
          host: 'cdn.example.com',
        },
      },
    ]);
  });

  it('omits MTPROXY assignments from all subscription formats (UI-only)', () => {
    const encryption = {
      decrypt: jest.fn((payload: string) => {
        if (payload === 'v1:credential-envelope') {
          return JSON.stringify({
            version: 1,
            password: 'p@ssword /?# ü',
          });
        }
        if (payload === 'inbound-secret-envelope') {
          return JSON.stringify({
            version: 1,
            obfsPassword: 'obfs &/secret',
          });
        }
        if (payload === 'v1:mtproxy-credential') {
          return JSON.stringify({
            version: 1,
            password: '0123456789abcdef0123456789abcdef',
          });
        }
        throw new Error('Unknown encrypted fixture');
      }),
    };
    const mixedBuilder = createBuilder(
      encryption as unknown as SecretEncryptionService,
    );
    const base = profileUser();
    const user: SubscriptionProfileUser = {
      ...base,
      inboundAssignments: [
        ...base.inboundAssignments,
        {
          id: 'assignment-mtproxy',
          credentialEncrypted: 'v1:mtproxy-credential',
          inbound: {
            id: 'inbound-mtproxy',
            tag: 'Edge_TG',
            protocol: 'MTPROXY',
            publicHost: 'vpn.example.com',
            publicPort: 10001,
            listenPort: 10001,
            displayNameTemplate: null,
            config: {
              secretMode: 'SECURE',
              tlsDomain: null,
            },
            secretDataEncrypted: null,
          },
        },
      ],
    };

    const mixedProfile = mixedBuilder.build(user);
    expect(mixedProfile.endpoints.map((endpoint) => endpoint.protocol)).toEqual(
      ['HYSTERIA2'],
    );
    expect(renderLinkList(mixedProfile)).not.toContain('t.me/proxy');
    expect(renderLinkList(mixedProfile)).not.toContain('tg://proxy');
    expect(renderClashProfile(mixedProfile)).not.toContain('mtproxy');
    expect(renderSingBoxProfile(mixedProfile)).not.toContain('mtproxy');
  });

  it('builds VLESS_GRPC_TLS and VLESS_TCP_TLS share links and sing-box outbounds', () => {
    const encryption = {
      decrypt: jest.fn((payload: string) => {
        if (payload === 'v1:vless-credential') {
          return JSON.stringify({
            version: 1,
            uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
          });
        }
        throw new Error('Unknown encrypted fixture');
      }),
    };
    const multiBuilder = createBuilder(
      encryption as unknown as SecretEncryptionService,
    );
    const user: SubscriptionProfileUser = {
      identity: 'Bob',
      username: 'bob',
      expireAt: null,
      dataLimitBytes: null,
      usedUploadBytes: 0n,
      usedDownloadBytes: 0n,
      plan: null,
      inboundAssignments: [
        {
          id: 'assignment-grpc',
          credentialEncrypted: 'v1:vless-credential',
          inbound: {
            id: 'inbound-grpc',
            tag: 'Edge_GRPC',
            protocol: 'VLESS_GRPC_TLS',
            publicHost: 'vpn.example.com',
            publicPort: 8446,
            listenPort: 8446,
            displayNameTemplate: null,
            config: {
              serviceName: 'GunService',
              tls: {
                mode: 'FILES',
                sni: 'vpn.example.com',
                certificatePath: '/cert.pem',
                keyPath: '/key.pem',
                certificatePemPresent: false,
                privateKeyPemPresent: false,
              },
            },
            secretDataEncrypted: null,
          },
        },
        {
          id: 'assignment-tcp',
          credentialEncrypted: 'v1:vless-credential',
          inbound: {
            id: 'inbound-tcp',
            tag: 'Edge_TCP',
            protocol: 'VLESS_TCP_TLS',
            publicHost: 'vpn.example.com',
            publicPort: 8447,
            listenPort: 8447,
            displayNameTemplate: null,
            config: {
              flow: 'xtls-rprx-vision',
              tls: {
                mode: 'FILES',
                sni: 'vpn.example.com',
                certificatePath: '/cert.pem',
                keyPath: '/key.pem',
                certificatePemPresent: false,
                privateKeyPemPresent: false,
              },
            },
            secretDataEncrypted: null,
          },
        },
      ],
    };

    const multiProfile = multiBuilder.build(user);
    const links = renderLinkList(multiProfile).trim().split('\n');
    const singBox = JSON.parse(renderSingBoxProfile(multiProfile)) as {
      outbounds: Array<Record<string, unknown>>;
    };
    const clash = parseYaml(renderClashProfile(multiProfile)) as {
      proxies: Array<Record<string, unknown>>;
    };

    expect(multiProfile.warnings).toBeUndefined();
    expect(links).toEqual([
      'vless://7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e@vpn.example.com:8446?encryption=none&security=tls&type=grpc&serviceName=GunService&sni=vpn.example.com&fp=chrome#Bob%20-%20Edge_GRPC',
      'vless://7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e@vpn.example.com:8447?encryption=none&security=tls&type=tcp&sni=vpn.example.com&fp=chrome&flow=xtls-rprx-vision#Bob%20-%20Edge_TCP',
    ]);
    expect(
      singBox.outbounds.filter((outbound) => outbound.type === 'vless'),
    ).toHaveLength(2);
    expect(clash.proxies.map((proxy) => proxy.network)).toEqual([
      'grpc',
      'tcp',
    ]);
  });
});

function profileUser(): SubscriptionProfileUser {
  return {
    identity: 'Alice / Europe',
    username: 'alice',
    expireAt: null,
    dataLimitBytes: null,
    usedUploadBytes: 0n,
    usedDownloadBytes: 0n,
    plan: null,
    inboundAssignments: [
      {
        id: 'assignment-id',
        credentialEncrypted: 'v1:credential-envelope',
        inbound: {
          id: 'inbound-id',
          tag: 'Edge_EU',
          protocol: 'HYSTERIA2',
          publicHost: 'vpn.example.com',
          publicPort: 8443,
          listenPort: 443,
          displayNameTemplate: null,
          config: {
            upMbps: 100,
            downMbps: 300,
            ignoreClientBandwidth: false,
            obfs: {
              type: 'SALAMANDER',
              passwordPresent: true,
            },
            tls: {
              mode: 'FILES',
              sni: 'vpn.example.com',
              alpn: ['h3'],
              minVersion: '1.2',
              cipherSuites: [],
              curvePreferences: [],
              kernelTx: false,
              kernelRx: false,
              clientInsecure: false,
              certificatePath: '/cert.pem',
              keyPath: '/key.pem',
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
          },
          secretDataEncrypted: 'inbound-secret-envelope',
        },
      },
    ],
  };
}
