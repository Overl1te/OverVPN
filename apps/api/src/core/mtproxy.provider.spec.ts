import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import {
  MtproxyReloadHandshakeAdapter,
  NodeCoreFileSystem,
  type ReloadAcknowledgement,
} from './core-adapters';
import type { CoreDesiredState, DesiredMtproxyInbound } from './core-provider';
import { MtproxyProvider } from './mtproxy.provider';

class FakeMtproxyReloadAdapter extends MtproxyReloadHandshakeAdapter {
  hashes: string[] = [];

  requestReload(hash: string): Promise<ReloadAcknowledgement> {
    this.hashes.push(hash);
    return Promise.resolve({
      requestId: `request-${this.hashes.length}`,
      hash,
      acknowledgedAt: new Date(),
    });
  }
}

describe('MtproxyProvider', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'overvpn-mtproxy-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('renders per-user secrets, maxUniqueIps, and loopback apiPort', () => {
    const provider = createProvider(directory);
    const rendered = provider.renderConfig(desiredState());
    const config = rendered.config as {
      inbounds: Array<{
        tag: string;
        listenPort: number;
        apiPort: number;
        users: Array<{
          name: string;
          secret: string;
          maxUniqueIps?: number;
        }>;
      }>;
    };

    expect(config.inbounds).toHaveLength(1);
    expect(config.inbounds[0]).toMatchObject({
      tag: 'tg-main',
      listenPort: 10_001,
      apiPort: 19_000,
    });
    expect(config.inbounds[0].users).toEqual([
      {
        name: 'd465128d-2cb5-431f-8843-00dcf6292a33',
        secret: 'a'.repeat(32),
        maxUniqueIps: 1,
      },
      {
        name: 'e576239e-3dc6-5420-9954-11edf7303b44',
        secret: 'b'.repeat(32),
      },
    ]);
    expect(rendered.secretValues).toEqual(
      expect.arrayContaining(['a'.repeat(32), 'b'.repeat(32)]),
    );
  });

  it('reads runtime stats for online clients and traffic counters', async () => {
    const statsPath = join(directory, 'runtime-stats.json');
    await writeFile(
      statsPath,
      JSON.stringify({
        version: 1,
        capturedAt: new Date().toISOString(),
        useMiddleProxy: true,
        inbounds: [
          {
            tag: 'tg-main',
            listenPort: 10_001,
            apiPort: 19_000,
            users: [
              {
                username: 'd465128d-2cb5-431f-8843-00dcf6292a33',
                currentConnections: 2,
                totalOctets: 4096,
                activeIps: ['1.2.3.4', '5.6.7.8'],
              },
              {
                username: 'e576239e-3dc6-5420-9954-11edf7303b44',
                currentConnections: 0,
                totalOctets: 100,
                activeIps: [],
              },
            ],
          },
        ],
      }),
      'utf8',
    );

    const provider = createProvider(directory, {
      MTPROXY_RUNTIME_STATS_PATH: statsPath,
    });

    const online = await provider.getOnlineClients();
    expect(online.partial).toBe(false);
    expect(online.clients).toHaveLength(2);
    expect(online.clients[0]).toMatchObject({
      engine: 'MTPROXY',
      panelUserId: 'd465128d-2cb5-431f-8843-00dcf6292a33',
      inboundTag: 'tg-main',
      ipAddress: '1.2.3.4',
    });

    const traffic = await provider.getTrafficSnapshot();
    expect(traffic.supported).toBe(true);
    if (!traffic.supported) {
      throw new Error('expected supported traffic snapshot');
    }
    expect(traffic.counters).toEqual([
      {
        engine: 'MTPROXY',
        scope: 'user',
        key: 'd465128d-2cb5-431f-8843-00dcf6292a33',
        uplinkBytes: '0',
        downlinkBytes: '4096',
      },
      {
        engine: 'MTPROXY',
        scope: 'user',
        key: 'e576239e-3dc6-5420-9954-11edf7303b44',
        uplinkBytes: '0',
        downlinkBytes: '100',
      },
    ]);
  });
});

function createProvider(
  directory: string,
  overrides: Partial<AppEnvironment> = {},
) {
  const values: Partial<AppEnvironment> = {
    MTPROXY_CONFIG_PATH: join(directory, 'config.json'),
    MTPROXY_LAST_KNOWN_GOOD_PATH: join(directory, 'config.lkg.json'),
    MTPROXY_HEARTBEAT_PATH: join(directory, 'heartbeat'),
    MTPROXY_HEARTBEAT_MAX_AGE_SECONDS: 15,
    MTPROXY_HEALTH_TIMEOUT_MS: 5_000,
    MTPROXY_RUNTIME_STATS_PATH: join(directory, 'runtime-stats.json'),
    MTPROXY_RUNTIME_STATS_MAX_AGE_SECONDS: 30,
    MTPROXY_PORT_MIN: 10_001,
    MTPROXY_PORT_MAX: 10_016,
    MTPROXY_API_PORT_BASE: 19_000,
    ...overrides,
  };
  const config = {
    get: (key: keyof AppEnvironment) => values[key],
  } as ConfigService<AppEnvironment, true>;
  return new MtproxyProvider(
    config,
    new NodeCoreFileSystem(),
    new FakeMtproxyReloadAdapter(),
  );
}

function desiredState(): CoreDesiredState {
  const inbound: DesiredMtproxyInbound = {
    id: '11111111-1111-4111-8111-111111111111',
    tag: 'tg-main',
    protocol: 'MTPROXY',
    listenHost: '0.0.0.0',
    listenPort: 10_001,
    publicHost: 'proxy.example.com',
    publicPort: 10_001,
    revision: 1,
    config: {
      secretMode: 'SECURE',
      tlsDomain: null,
    },
    secrets: { version: 1 },
    assignments: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        userId: 'd465128d-2cb5-431f-8843-00dcf6292a33',
        userIdentity: 'alice',
        credentialName: 'd465128d-2cb5-431f-8843-00dcf6292a33',
        credentialVersion: 1,
        credential: { version: 1, password: 'a'.repeat(32) },
        maxUniqueIps: 1,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        userId: 'e576239e-3dc6-5420-9954-11edf7303b44',
        userIdentity: 'bob',
        credentialName: 'e576239e-3dc6-5420-9954-11edf7303b44',
        credentialVersion: 1,
        credential: { version: 1, password: 'b'.repeat(32) },
        maxUniqueIps: null,
      },
    ],
  };
  return {
    engine: 'MTPROXY',
    loadedAt: new Date('2026-01-01T00:00:00.000Z'),
    desiredRevision: 1,
    inbounds: [inbound],
    inboundRevisions: [{ id: inbound.id, revision: 1 }],
    userRevisions: [
      { id: 'd465128d-2cb5-431f-8843-00dcf6292a33', revision: 1 },
      { id: 'e576239e-3dc6-5420-9954-11edf7303b44', revision: 1 },
    ],
  };
}
