import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import { SecretEncryptionService } from '../auth/auth-crypto';
import type { AppEnvironment } from '../config/environment';
import type { PrismaService } from '../infrastructure/infrastructure.module';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('redacts telegram secrets from GET and bumps revision on update', async () => {
    const rows = new Map<
      string,
      {
        key: string;
        value: unknown;
        revision: number;
        isSecret: boolean;
        updatedAt: Date;
        updatedByAdminId: string | null;
      }
    >();
    const prisma = {
      systemConfig: {
        findUnique: ({ where }: { where: { key: string } }) =>
          Promise.resolve(rows.get(where.key) ?? null),
        create: ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            key: data.key as string,
            value: data.value,
            revision: (data.revision as number) ?? 1,
            isSecret: Boolean(data.isSecret),
            updatedAt: new Date(),
            updatedByAdminId: (data.updatedByAdminId as string) ?? null,
          };
          rows.set(row.key, row);
          return Promise.resolve(row);
        },
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = rows.get(where.key);
          if (!existing) {
            const row = {
              key: create.key as string,
              value: create.value,
              revision: (create.revision as number) ?? 1,
              isSecret: Boolean(create.isSecret),
              updatedAt: new Date(),
              updatedByAdminId: (create.updatedByAdminId as string) ?? null,
            };
            rows.set(row.key, row);
            return Promise.resolve(row);
          }
          Object.assign(existing, update, { updatedAt: new Date() });
          return Promise.resolve(existing);
        },
        deleteMany: ({ where }: { where: { key: string } }) => {
          rows.delete(where.key);
          return Promise.resolve({ count: 1 });
        },
      },
      $transaction: (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    } as unknown as PrismaService;

    const auditRecord = jest.fn(() => Promise.resolve(undefined));
    const audit = {
      record: auditRecord,
      recordFailureSafely: () => Promise.resolve(undefined),
    } as unknown as AuditService;
    const encryption = new SecretEncryptionService(testConfig());
    const service = new SettingsService(
      prisma,
      audit,
      encryption,
      testConfig(),
    );

    const initial = await service.get();
    expect(initial.revision).toBe(1);
    expect(initial).not.toHaveProperty('telegramBotToken');
    expect(initial.telegramBotTokenConfigured).toBe(false);

    const updated = await service.update(
      {
        notifyTelegramEnabled: true,
        profileUpdateIntervalHours: 12,
        telegramBotToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
      },
      {
        id: '11111111-1111-4111-8111-111111111111',
        username: 'admin',
        role: 'ADMIN',
        locale: 'en',
        active: true,
        totpEnabled: false,
        lastLoginAt: null,
      },
      { requestId: 'r1', ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(updated.revision).toBe(2);
    expect(updated.profileUpdateIntervalHours).toBe(12);
    expect(updated.notifyTelegramEnabled).toBe(true);
    expect(updated.telegramBotTokenConfigured).toBe(true);
    expect(JSON.stringify(updated)).not.toContain(
      'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    );
    expect(auditRecord).toHaveBeenCalled();
    const auditCalls = auditRecord.mock.calls as unknown as Array<
      [
        {
          action: string;
          after: { telegramBotToken: string; revision: number };
        },
      ]
    >;
    expect(auditCalls[0]?.[0].action).toBe('SYSTEM_CONFIG_UPDATE');
    expect(auditCalls[0]?.[0].after.telegramBotToken).toBe('[REDACTED]');
    expect(auditCalls[0]?.[0].after.revision).toBe(2);
  });
});

function testConfig(): ConfigService<AppEnvironment, true> {
  const values: Record<string, unknown> = {
    SUB_PUBLIC_BASE_URL: 'https://vpn.example.com',
    VPN_PUBLIC_HOST: 'vpn.example.com',
    SUB_PROFILE_UPDATE_INTERVAL_HOURS: 6,
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_CHAT_ID: undefined,
    CORS_ORIGINS: ['http://localhost:5173'],
    WORKERS_ENABLED: false,
    BACKUP_DIR: '/var/lib/overvpn/backups',
    BACKUP_RETENTION_DAYS: 30,
    BACKUP_ENCRYPT: true,
    NODE_ENV: 'test',
    SWAGGER_ENABLED: true,
    SECRETS_MASTER_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
  return {
    get: (key: string) => values[key],
  } as ConfigService<AppEnvironment, true>;
}
