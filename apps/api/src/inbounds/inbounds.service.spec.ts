import type { AuditService } from '../audit/audit.service';
import type { SecretEncryptionService } from '../auth/auth-crypto';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import type { CoreApplyService } from '../core/core-apply.service';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import { InboundsService } from './inbounds.service';

describe('InboundsService VLESS Reality create', () => {
  const actor: AuthenticatedAdmin = {
    id: 'a0f6395d-0739-473d-b0e5-3f9bdc69a173',
    username: 'admin',
    role: 'ADMIN',
    locale: 'en',
    active: true,
    totpEnabled: false,
    lastLoginAt: null,
  };
  const metadata: RequestMetadata = {
    requestId: '01ae5a83-68fc-4376-94e9-4a8abfa2aa4e',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };

  it('persists encrypted Reality secrets and public config flags', async () => {
    const encryption = {
      encrypt: jest.fn((payload: string) => `enc:${payload}`),
      decrypt: jest.fn(),
    };
    const processAdapter = {
      run: jest.fn().mockResolvedValue({
        exitCode: 0,
        signal: null,
        stdout: 'PrivateKey: test-private-key\nPublicKey: test-public-key\n',
        stderr: '',
        timedOut: false,
      }),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
      recordFailureSafely: jest.fn().mockResolvedValue(undefined),
    };
    const coreApply = {
      apply: jest.fn().mockResolvedValue({ status: 'SUCCEEDED' }),
    };
    const inboundCreate = jest.fn().mockResolvedValue({
      id: '443f67c0-f935-44d1-a9c1-b00dbd5d3f09',
      tag: 'vless-main',
      engine: 'SING_BOX',
      protocol: 'VLESS_REALITY',
      listenHost: '0.0.0.0',
      listenPort: 443,
      publicHost: 'vpn.example.com',
      publicPort: 443,
      enabled: true,
      config: {
        handshakeServer: 'www.cloudflare.com',
        handshakePort: 443,
        serverNames: ['www.cloudflare.com'],
        shortIds: ['0123456789abcdef', ''],
        flow: 'xtls-rprx-vision',
        transport: 'none',
        fingerprint: 'chrome',
        publicKeyPresent: true,
        privateKeyPresent: true,
      },
      secretDataEncrypted: 'enc:{"version":1}',
      revision: 1,
      needsApply: true,
      disabledAt: null,
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
      updatedAt: new Date('2026-07-12T00:00:00.000Z'),
      _count: { userAssignments: 0 },
    });
    const inboundFindFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      inbound: { findFirst: inboundFindFirst },
      $transaction: jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            inbound: { create: inboundCreate, findFirst: inboundFindFirst },
            coreState: { upsert: jest.fn().mockResolvedValue(undefined) },
          }),
      ),
    };

    const service = new InboundsService(
      prisma as unknown as PrismaService,
      encryption as unknown as SecretEncryptionService,
      audit as unknown as AuditService,
      coreApply as unknown as CoreApplyService,
      processAdapter,
      {
        get: (key: string) => {
          if (key === 'SING_BOX_CONFIG_PATH') return '/tmp/config.json';
          if (key === 'XRAY_CONFIG_PATH') return '/tmp/xray/config.json';
          if (key === 'SING_BOX_BINARY_PATH') return '/usr/bin/sing-box';
          if (key === 'SING_BOX_PROCESS_TIMEOUT_MS') return 500;
          return undefined;
        },
      } as never,
    );

    const result = await service.create(
      {
        tag: 'vless-main',
        protocol: 'VLESS_REALITY',
        settings: {
          listenHost: '0.0.0.0',
          listenPort: 443,
          publicHost: 'vpn.example.com',
          enabled: true,
          handshakeServer: 'www.cloudflare.com',
          handshakePort: 443,
          serverNames: ['www.cloudflare.com'],
          shortIds: ['0123456789abcdef', ''],
          flow: 'xtls-rprx-vision',
          transport: 'none',
          fingerprint: 'chrome',
        },
      },
      actor,
      metadata,
    );

    expect(processAdapter.run).toHaveBeenCalledWith(
      '/usr/bin/sing-box',
      ['generate', 'reality-keypair'],
      500,
    );
    expect(inboundCreate).toHaveBeenCalled();
    const createCalls = inboundCreate.mock.calls as unknown as Array<
      [{ data: { protocol: string; config: Record<string, unknown> } }]
    >;
    const createArg = createCalls[0]?.[0];
    expect(createArg?.data.protocol).toBe('VLESS_REALITY');
    expect(createArg?.data.config.publicKeyPresent).toBe(true);
    expect(createArg?.data.config.privateKeyPresent).toBe(true);
    expect(result.inbound?.protocol).toBe('VLESS_REALITY');
    if (result.inbound?.protocol === 'VLESS_REALITY') {
      expect(result.inbound.settings.publicKeyPresent).toBe(true);
    }
    expect(encryption.encrypt).toHaveBeenCalled();
  });
});
