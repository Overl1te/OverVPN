import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  CoreHttpAdapter,
  type HttpJsonResponse,
  NodeCoreFileSystem,
  ProcessAdapter,
  type ProcessExecutionResult,
  ReloadHandshakeAdapter,
  type ReloadAcknowledgement,
} from './core-adapters';
import type {
  CoreDesiredState,
  DesiredHysteria2Inbound,
} from './core-provider';
import { SingBoxProvider } from './sing-box.provider';
import { type RawV2RayStat, V2RayStatsAdapter } from './v2ray-stats.adapter';

class FakeProcessAdapter extends ProcessAdapter {
  calls: Array<{ executable: string; args: readonly string[] }> = [];

  constructor(private readonly result: ProcessExecutionResult) {
    super();
  }

  run(executable: string, args: readonly string[]) {
    this.calls.push({ executable, args });
    return Promise.resolve(this.result);
  }
}

class FakeReloadAdapter extends ReloadHandshakeAdapter {
  hashes: string[] = [];

  constructor(
    private readonly handler: (index: number, hash: string) => void = () =>
      undefined,
  ) {
    super();
  }

  requestReload(hash: string): Promise<ReloadAcknowledgement> {
    const index = this.hashes.length;
    this.hashes.push(hash);
    this.handler(index, hash);
    return Promise.resolve({
      requestId: `request-${index}`,
      hash,
      acknowledgedAt: new Date(),
    });
  }
}

class FakeHttpAdapter extends CoreHttpAdapter {
  constructor(private readonly healthyResponses: boolean[]) {
    super();
  }

  getJson(): Promise<HttpJsonResponse> {
    const healthy = this.healthyResponses.shift() ?? false;
    return Promise.resolve({
      status: healthy ? 200 : 503,
      body: healthy ? { version: '1.13.14' } : {},
      latencyMs: 1,
    });
  }
}

class FakeStatsAdapter extends V2RayStatsAdapter {
  query(): Promise<RawV2RayStat[]> {
    return Promise.resolve([]);
  }
}

describe('SingBoxProvider', () => {
  let directory: string;
  let configPath: string;
  let lkgPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'overvpn-sing-box-'));
    configPath = join(directory, 'config.json');
    lkgPath = join(directory, 'config.lkg.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('renders a deterministic current sing-box config and redacts every secret', () => {
    const process = successfulProcess();
    const provider = createProvider(
      process,
      new FakeReloadAdapter(),
      new FakeHttpAdapter([true]),
    );
    const first = provider.renderConfig(desiredState());
    const second = provider.renderConfig(desiredState());

    expect(first.canonical).toBe(second.canonical);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe(
      'c0a7d50ca86959be687b811f6d6941471481c3c38f2422d20b4627dd4706c1a7',
    );
    expect(first.canonical).toContain('"type": "hysteria2"');
    expect(first.canonical).toContain(
      '"name": "d465128d-2cb5-431f-8843-00dcf6292a33"',
    );
    expect(first.canonical).toContain('assignment-password');
    expect(first.canonical).toContain('obfs-password');
    expect(first.redactedCanonical).not.toContain('assignment-password');
    expect(first.redactedCanonical).not.toContain('obfs-password');
    expect(first.redactedCanonical).not.toContain('clash-secret');
    expect(first.redactedCanonical).toContain('[REDACTED]');
  });

  it('invokes the configured binary with exact safe check arguments', async () => {
    const process = successfulProcess();
    const provider = createProvider(
      process,
      new FakeReloadAdapter(),
      new FakeHttpAdapter([true]),
    );
    const rendered = provider.renderConfig(desiredState());
    const validation = await provider.validate(rendered);

    expect(validation.error).toBeNull();
    expect(validation.valid).toBe(true);
    expect(process.calls).toHaveLength(1);
    expect(process.calls[0]?.executable).toBe('C:\\sing-box\\sing-box.exe');
    expect(process.calls[0]?.args[0]).toBe('check');
    expect(process.calls[0]?.args[1]).toBe('-c');
    expect(process.calls[0]?.args[2]).toMatch(/\.candidate\.json$/);
  });

  it('does not replace current bytes when validation fails', async () => {
    const oldBytes = Buffer.from('{"old":true}\n');
    await writeFile(configPath, oldBytes);
    const process = new FakeProcessAdapter({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: 'invalid config',
      timedOut: false,
    });
    const provider = createProvider(
      process,
      new FakeReloadAdapter(),
      new FakeHttpAdapter([true]),
    );
    const rendered = provider.renderConfig(desiredState());
    const validation = await provider.validate(rendered);

    expect(validation.valid).toBe(false);
    expect(await readFile(configPath)).toEqual(oldBytes);
  });

  it('applies a validated config and acknowledges the desired hash', async () => {
    await writeFile(configPath, '{"old":true}\n');
    const reload = new FakeReloadAdapter();
    const provider = createProvider(
      successfulProcess(),
      reload,
      new FakeHttpAdapter([true]),
    );
    const rendered = provider.renderConfig(desiredState());

    const result = await provider.apply(rendered);

    expect(result.error).toBeNull();
    expect(result.status).toBe('SUCCEEDED');
    expect(await readFile(configPath, 'utf8')).toBe(rendered.canonical);
    expect(reload.hashes).toEqual([rendered.hash]);
  });

  it('restores exact old bytes and reloads them after a reload failure', async () => {
    const oldBytes = Buffer.from('{\n  "old": true\n}\n');
    await writeFile(configPath, oldBytes);
    const reload = new FakeReloadAdapter((index) => {
      if (index === 0) throw new Error('reload rejected');
    });
    const provider = createProvider(
      successfulProcess(),
      reload,
      new FakeHttpAdapter([true]),
    );
    const rendered = provider.renderConfig(desiredState());

    const result = await provider.apply(rendered);

    expect(result.status).toBe('ROLLED_BACK');
    expect(result.rollbackOutcome).toBe('SUCCEEDED');
    expect(await readFile(configPath)).toEqual(oldBytes);
    expect(reload.hashes).toHaveLength(2);
    expect(reload.hashes[0]).toBe(rendered.hash);
    expect(reload.hashes[1]).toBe(result.previousHash);
  });

  it('restores old bytes and re-applies them after health verification fails', async () => {
    const oldBytes = Buffer.from('{"old":"exact bytes"}\n');
    await writeFile(configPath, oldBytes);
    const reload = new FakeReloadAdapter();
    const provider = createProvider(
      successfulProcess(),
      reload,
      new FakeHttpAdapter([false, true]),
      1,
    );
    const rendered = provider.renderConfig(desiredState());

    const result = await provider.apply(rendered);

    expect(result.status).toBe('ROLLED_BACK');
    expect(await readFile(configPath)).toEqual(oldBytes);
    expect(reload.hashes).toHaveLength(2);
  });

  it('renders valid inbound blocks for VLESS, Trojan, and Shadowsocks', () => {
    const provider = createProvider(
      successfulProcess(),
      new FakeReloadAdapter(),
      new FakeHttpAdapter([true]),
    );
    const rendered = provider.renderConfig(multiProtocolState());
    const parsed = JSON.parse(rendered.canonical) as {
      inbounds: Array<Record<string, unknown>>;
    };

    expect(parsed.inbounds.map((inbound) => inbound.type)).toEqual([
      'hysteria2',
      'shadowsocks',
      'trojan',
      'vless',
    ]);
    expect(parsed.inbounds[1]).toMatchObject({
      type: 'shadowsocks',
      method: '2022-blake3-aes-256-gcm',
      password: 'ss-server-password',
    });
    expect(parsed.inbounds[2]).toMatchObject({
      type: 'trojan',
      users: [
        {
          name: 'd465128d-2cb5-431f-8843-00dcf6292a33',
          password: 'trojan-password',
        },
      ],
    });
    expect(parsed.inbounds[3]).toMatchObject({
      type: 'vless',
      tls: {
        reality: {
          enabled: true,
          private_key: 'reality-private-key',
          short_id: ['0123456789abcdef'],
        },
      },
    });
  });

  function createProvider(
    process: ProcessAdapter,
    reload: ReloadHandshakeAdapter,
    http: CoreHttpAdapter,
    reloadTimeoutMs = 1_000,
  ): SingBoxProvider {
    return new SingBoxProvider(
      fakeConfig({
        SING_BOX_BINARY_PATH: 'C:\\sing-box\\sing-box.exe',
        SING_BOX_CONFIG_PATH: configPath,
        SING_BOX_LAST_KNOWN_GOOD_PATH: lkgPath,
        SING_BOX_PROCESS_TIMEOUT_MS: 500,
        SING_BOX_RELOAD_TIMEOUT_MS: reloadTimeoutMs,
        SING_BOX_HEALTH_TIMEOUT_MS: 100,
        SING_BOX_CLASH_API_URL: 'http://127.0.0.1:9090',
        SING_BOX_CLASH_API_LISTEN: '0.0.0.0:9090',
        SING_BOX_CLASH_API_SECRET:
          'clash-secret-which-is-longer-than-thirty-two-bytes',
        SING_BOX_V2RAY_API_LISTEN: '0.0.0.0:8080',
      }),
      process,
      new NodeCoreFileSystem(),
      reload,
      http,
      new FakeStatsAdapter(),
    );
  }
});

function successfulProcess(): FakeProcessAdapter {
  return new FakeProcessAdapter({
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
  });
}

function fakeConfig(values: Partial<AppEnvironment>) {
  return {
    get: (key: keyof AppEnvironment) => values[key],
  } as ConfigService<AppEnvironment, true>;
}

function desiredState(): CoreDesiredState {
  return {
    engine: 'SING_BOX',
    loadedAt: new Date('2026-07-12T00:00:00.000Z'),
    desiredRevision: 4,
    inboundRevisions: [
      { id: '443f67c0-f935-44d1-a9c1-b00dbd5d3f09', revision: 2 },
    ],
    userRevisions: [
      { id: 'd465128d-2cb5-431f-8843-00dcf6292a33', revision: 3 },
    ],
    inbounds: [
      {
        id: '443f67c0-f935-44d1-a9c1-b00dbd5d3f09',
        protocol: 'HYSTERIA2',
        tag: 'hy2-main',
        listenHost: '0.0.0.0',
        listenPort: 443,
        publicHost: 'vpn.example.com',
        publicPort: 443,
        revision: 2,
        config: {
          upMbps: 100,
          downMbps: 200,
          ignoreClientBandwidth: false,
          obfs: { type: 'SALAMANDER', passwordPresent: true },
          tls: {
            mode: 'FILES',
            sni: 'vpn.example.com',
            alpn: ['h3'],
            minVersion: '1.2',
            maxVersion: '1.3',
            cipherSuites: [],
            curvePreferences: [],
            kernelTx: false,
            kernelRx: false,
            clientInsecure: false,
            certificatePath: '/var/lib/sing-box-certs/cert.pem',
            keyPath: '/var/lib/sing-box-certs/key.pem',
            certificatePemPresent: false,
            privateKeyPemPresent: false,
          },
          masquerade: null,
          bindInterface: null,
          routingMark: null,
          reuseAddr: true,
          netns: null,
          tcpFastOpen: false,
          tcpMultiPath: false,
          disableTcpKeepAlive: false,
          tcpKeepAlive: null,
          tcpKeepAliveInterval: null,
          udpFragment: true,
          udpTimeout: '30s',
          detour: null,
          brutalDebug: false,
        },
        secrets: {
          version: 1,
          obfsPassword: 'obfs-password',
        },
        assignments: [
          {
            id: 'b2678656-c0f0-49d8-bbbd-720c735cf7b9',
            userId: 'd465128d-2cb5-431f-8843-00dcf6292a33',
            userIdentity: 'alice',
            credentialName: 'd465128d-2cb5-431f-8843-00dcf6292a33',
            credentialVersion: 1,
            credential: {
              version: 1,
              password: 'assignment-password',
            },
          },
        ],
      },
    ],
  };
}

function multiProtocolState(): CoreDesiredState {
  const assignment = {
    id: 'b2678656-c0f0-49d8-bbbd-720c735cf7b9',
    userId: 'd465128d-2cb5-431f-8843-00dcf6292a33',
    userIdentity: 'alice',
    credentialName: 'd465128d-2cb5-431f-8843-00dcf6292a33',
    credentialVersion: 1,
  };
  return {
    engine: 'SING_BOX',
    loadedAt: new Date('2026-07-12T00:00:00.000Z'),
    desiredRevision: 5,
    inboundRevisions: [],
    userRevisions: [
      { id: 'd465128d-2cb5-431f-8843-00dcf6292a33', revision: 3 },
    ],
    inbounds: [
      {
        ...desiredState().inbounds[0],
        tag: 'hy2-main',
      },
      {
        id: '553f67c0-f935-44d1-a9c1-b00dbd5d3f10',
        protocol: 'SHADOWSOCKS',
        tag: 'ss-main',
        listenHost: '0.0.0.0',
        listenPort: 8388,
        publicHost: 'vpn.example.com',
        publicPort: 8388,
        revision: 1,
        config: {
          method: '2022-blake3-aes-256-gcm',
          passwordPresent: true,
        },
        secrets: {
          version: 1,
          serverPassword: 'ss-server-password',
        },
        assignments: [
          {
            ...assignment,
            credential: { version: 1, password: 'ss-user-password' },
          },
        ],
      },
      {
        id: '663f67c0-f935-44d1-a9c1-b00dbd5d3f11',
        protocol: 'TROJAN',
        tag: 'trojan-main',
        listenHost: '0.0.0.0',
        listenPort: 8443,
        publicHost: 'vpn.example.com',
        publicPort: 8443,
        revision: 1,
        config: {
          tls: (desiredState().inbounds[0] as DesiredHysteria2Inbound).config
            .tls,
          fallback: null,
        },
        secrets: { version: 1 },
        assignments: [
          {
            ...assignment,
            credential: { version: 1, password: 'trojan-password' },
          },
        ],
      },
      {
        id: '773f67c0-f935-44d1-a9c1-b00dbd5d3f12',
        protocol: 'VLESS_REALITY',
        tag: 'vless-main',
        listenHost: '0.0.0.0',
        listenPort: 9443,
        publicHost: 'vpn.example.com',
        publicPort: 9443,
        revision: 1,
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
        secrets: {
          version: 1,
          privateKey: 'reality-private-key',
          publicKey: 'reality-public-key',
        },
        assignments: [
          {
            ...assignment,
            credential: {
              version: 1,
              uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
            },
          },
        ],
      },
    ],
  };
}
