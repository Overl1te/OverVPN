import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  NodeCoreFileSystem,
  ProcessAdapter,
  type ProcessExecutionResult,
  type ReloadAcknowledgement,
  XrayReloadHandshakeAdapter,
} from './core-adapters';
import type { CoreDesiredState } from './core-provider';
import {
  type RawXrayStat,
  type RawXrayUserStat,
  XrayStatsAdapter,
} from './xray-stats.adapter';
import { XrayProvider } from './xray.provider';

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

class FakeReloadAdapter extends XrayReloadHandshakeAdapter {
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

class FakeStatsAdapter extends XrayStatsAdapter {
  constructor(private readonly healthy = true) {
    super();
  }

  queryStats(): Promise<RawXrayStat[]> {
    if (!this.healthy) {
      return Promise.reject(new Error('stats unavailable'));
    }
    return Promise.resolve([]);
  }

  getUsersStats(): Promise<RawXrayUserStat[]> {
    if (!this.healthy) {
      return Promise.reject(new Error('stats unavailable'));
    }
    return Promise.resolve([]);
  }
}

describe('XrayProvider', () => {
  let directory: string;
  let configPath: string;
  let lkgPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'overvpn-xray-'));
    configPath = join(directory, 'config.json');
    lkgPath = join(directory, 'config.lkg.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('renders a deterministic Xray config and redacts PEM secrets', () => {
    const process = successfulProcess();
    const provider = createProvider(process, new FakeReloadAdapter());
    const first = provider.renderConfig(desiredState());
    const second = provider.renderConfig(desiredState());

    expect(first.canonical).toBe(second.canonical);
    expect(first.hash).toBe(second.hash);
    expect(first.canonical).toContain('"protocol": "vless"');
    expect(first.canonical).toContain('"network": "xhttp"');
    expect(first.canonical).toContain('"path": "/xhttp"');
    expect(first.canonical).toContain(
      '"email": "d465128d-2cb5-431f-8843-00dcf6292a33"',
    );
    expect(first.canonical).toContain('-----BEGIN CERTIFICATE-----');
    expect(first.canonical).toContain('-----BEGIN PRIVATE KEY-----');
    expect(first.redactedCanonical).not.toContain(
      '-----BEGIN CERTIFICATE-----',
    );
    expect(first.redactedCanonical).not.toContain(
      '-----BEGIN PRIVATE KEY-----',
    );
    expect(first.redactedCanonical).toContain('[REDACTED]');
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('invokes the configured binary with exact run -test arguments', async () => {
    const process = successfulProcess();
    const provider = createProvider(process, new FakeReloadAdapter());
    const rendered = provider.renderConfig(desiredState());
    const validation = await provider.validate(rendered);

    expect(validation.error).toBeNull();
    expect(validation.valid).toBe(true);
    expect(process.calls).toHaveLength(1);
    expect(process.calls[0]?.executable).toBe('C:\\xray\\xray.exe');
    expect(process.calls[0]?.args).toEqual([
      'run',
      '-test',
      '-config',
      expect.stringMatching(/\.candidate\.json$/),
    ]);
  });

  it('applies a validated config and acknowledges the desired hash', async () => {
    await writeFile(configPath, '{"old":true}\n');
    const reload = new FakeReloadAdapter();
    const provider = createProvider(successfulProcess(), reload);
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
    const provider = createProvider(successfulProcess(), reload);
    const rendered = provider.renderConfig(desiredState());

    const result = await provider.apply(rendered);

    expect(result.status).toBe('ROLLED_BACK');
    expect(result.rollbackOutcome).toBe('SUCCEEDED');
    expect(await readFile(configPath)).toEqual(oldBytes);
    expect(reload.hashes).toHaveLength(2);
    expect(reload.hashes[0]).toBe(rendered.hash);
    expect(reload.hashes[1]).toBe(result.previousHash);
  });

  function createProvider(
    process: ProcessAdapter,
    reload: XrayReloadHandshakeAdapter,
    healthy = true,
  ): XrayProvider {
    return new XrayProvider(
      fakeConfig({
        XRAY_BINARY_PATH: 'C:\\xray\\xray.exe',
        XRAY_CONFIG_PATH: configPath,
        XRAY_LAST_KNOWN_GOOD_PATH: lkgPath,
        XRAY_PROCESS_TIMEOUT_MS: 500,
        XRAY_RELOAD_TIMEOUT_MS: 1_000,
        XRAY_HEALTH_TIMEOUT_MS: 100,
        XRAY_API_LISTEN: '127.0.0.1:10085',
        XRAY_STATS_ADDRESS: '127.0.0.1:10085',
      }),
      process,
      new NodeCoreFileSystem(),
      reload,
      new FakeStatsAdapter(healthy),
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
    engine: 'XRAY',
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
        protocol: 'VLESS_XHTTP_TLS',
        tag: 'vless-xhttp-main',
        listenHost: '0.0.0.0',
        listenPort: 443,
        publicHost: 'vpn.example.com',
        publicPort: 443,
        revision: 2,
        config: {
          path: '/xhttp',
          host: 'cdn.example.com',
          mode: 'auto',
          tls: {
            mode: 'FILES',
            sni: 'vpn.example.com',
            certificatePath: null,
            keyPath: null,
            certificatePemPresent: true,
            privateKeyPemPresent: true,
          },
        },
        secrets: {
          version: 1,
          certificatePem:
            '-----BEGIN CERTIFICATE-----\nMIIBcert\n-----END CERTIFICATE-----\n',
          privateKeyPem:
            '-----BEGIN PRIVATE KEY-----\nMIIBkey\n-----END PRIVATE KEY-----\n',
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
              uuid: '7d8c3f2a-1b4e-4a9c-8d3e-2f1a4b5c6d7e',
            },
          },
        ],
      },
    ],
  };
}
