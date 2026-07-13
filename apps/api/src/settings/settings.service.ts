import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SystemSettings,
  UpdateSystemSettings,
} from '@overvpn/shared/schemas';
import { AuditService } from '../audit/audit.service';
import { SecretEncryptionService } from '../auth/auth-crypto';
import { ApiException } from '../common/api-error';
import type {
  AuthenticatedAdmin,
  RequestMetadata,
} from '../common/authorization';
import type { AppEnvironment } from '../config/environment';
import { PrismaService } from '../infrastructure/infrastructure.module';

const SETTINGS_KEY = 'system.settings';
const TELEGRAM_TOKEN_KEY = 'system.telegramBotToken';
const TELEGRAM_CHAT_KEY = 'system.telegramChatId';

type StoredSettings = {
  panelUrl: string | null;
  subPublicBaseUrl: string | null;
  profileUpdateIntervalHours: number | null;
  notifyTelegramEnabled: boolean | null;
  featureFlags: Record<string, boolean>;
};

const defaultStored = (): StoredSettings => ({
  panelUrl: null,
  subPublicBaseUrl: null,
  profileUpdateIntervalHours: null,
  notifyTelegramEnabled: null,
  featureFlags: {},
});

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: SecretEncryptionService,
    private readonly config: ConfigService<AppEnvironment, true>,
  ) {}

  async get(): Promise<SystemSettings> {
    await this.ensureDefaults();
    return this.readMerged();
  }

  async update(
    input: UpdateSystemSettings,
    actor: AuthenticatedAdmin,
    metadata: RequestMetadata,
  ): Promise<SystemSettings> {
    const before = await this.get();
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await this.loadStored(tx);
        const next: StoredSettings = {
          panelUrl:
            input.panelUrl === undefined
              ? current.panelUrl
              : input.panelUrl === ''
                ? null
                : input.panelUrl,
          subPublicBaseUrl:
            input.subPublicBaseUrl === undefined
              ? current.subPublicBaseUrl
              : input.subPublicBaseUrl,
          profileUpdateIntervalHours:
            input.profileUpdateIntervalHours === undefined
              ? current.profileUpdateIntervalHours
              : input.profileUpdateIntervalHours,
          notifyTelegramEnabled:
            input.notifyTelegramEnabled === undefined
              ? current.notifyTelegramEnabled
              : input.notifyTelegramEnabled,
          featureFlags:
            input.featureFlags === undefined
              ? current.featureFlags
              : input.featureFlags,
        };

        const settingsRow = await tx.systemConfig.findUnique({
          where: { key: SETTINGS_KEY },
        });
        const revision = (settingsRow?.revision ?? 0) + 1;
        await tx.systemConfig.upsert({
          where: { key: SETTINGS_KEY },
          create: {
            key: SETTINGS_KEY,
            value: next,
            description: 'Panel system settings (non-secret)',
            isSecret: false,
            revision,
            updatedByAdminId: actor.id,
          },
          update: {
            value: next,
            revision,
            updatedByAdminId: actor.id,
          },
        });

        if (input.telegramBotToken !== undefined) {
          await this.upsertSecret(
            tx,
            TELEGRAM_TOKEN_KEY,
            input.telegramBotToken,
            actor.id,
            'Encrypted Telegram bot token',
          );
        }
        if (input.telegramChatId !== undefined) {
          await this.upsertSecret(
            tx,
            TELEGRAM_CHAT_KEY,
            input.telegramChatId,
            actor.id,
            'Encrypted Telegram chat id',
          );
        }

        await this.audit.record(
          {
            actorAdminId: actor.id,
            action: 'SYSTEM_CONFIG_UPDATE',
            resourceType: 'system_config',
            resourceId: SETTINGS_KEY,
            requestId: metadata.requestId,
            ipAddress: metadata.ipAddress,
            before: redactSettings(before),
            after: {
              ...next,
              telegramBotToken:
                input.telegramBotToken === undefined
                  ? undefined
                  : input.telegramBotToken === null
                    ? null
                    : '[REDACTED]',
              telegramChatId:
                input.telegramChatId === undefined
                  ? undefined
                  : input.telegramChatId === null
                    ? null
                    : '[REDACTED]',
              revision,
            },
          },
          tx,
        );
      });
      return this.readMerged();
    } catch (error: unknown) {
      if (error instanceof ApiException) {
        throw error;
      }
      await this.audit.recordFailureSafely({
        actorAdminId: actor.id,
        action: 'SYSTEM_CONFIG_UPDATE',
        resourceType: 'system_config',
        resourceId: SETTINGS_KEY,
        requestId: metadata.requestId,
        ipAddress: metadata.ipAddress,
        metadata: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async ensureDefaults(): Promise<void> {
    const existing = await this.prisma.systemConfig.findUnique({
      where: { key: SETTINGS_KEY },
    });
    if (existing) {
      return;
    }
    const defaults: StoredSettings = {
      panelUrl: null,
      subPublicBaseUrl: this.config.get('SUB_PUBLIC_BASE_URL', { infer: true }),
      profileUpdateIntervalHours: this.config.get(
        'SUB_PROFILE_UPDATE_INTERVAL_HOURS',
        { infer: true },
      ),
      notifyTelegramEnabled: this.config.get('TELEGRAM_ENABLED', {
        infer: true,
      }),
      featureFlags: {},
    };
    await this.prisma.systemConfig.create({
      data: {
        key: SETTINGS_KEY,
        value: defaults,
        description: 'Panel system settings (non-secret)',
        isSecret: false,
        revision: 1,
      },
    });
  }

  private async readMerged(): Promise<SystemSettings> {
    const [settingsRow, tokenRow, chatRow] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: SETTINGS_KEY } }),
      this.prisma.systemConfig.findUnique({
        where: { key: TELEGRAM_TOKEN_KEY },
      }),
      this.prisma.systemConfig.findUnique({
        where: { key: TELEGRAM_CHAT_KEY },
      }),
    ]);
    const stored = parseStored(settingsRow?.value);
    const envSub = this.config.get('SUB_PUBLIC_BASE_URL', { infer: true });
    const envInterval = this.config.get('SUB_PROFILE_UPDATE_INTERVAL_HOURS', {
      infer: true,
    });
    const envTelegram = this.config.get('TELEGRAM_ENABLED', { infer: true });
    const envToken = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    const envChat = this.config.get('TELEGRAM_CHAT_ID', { infer: true });
    return {
      panelUrl: stored.panelUrl,
      subPublicBaseUrl: stored.subPublicBaseUrl ?? envSub,
      profileUpdateIntervalHours:
        stored.profileUpdateIntervalHours ?? envInterval,
      notifyTelegramEnabled: stored.notifyTelegramEnabled ?? envTelegram,
      telegramBotTokenConfigured: Boolean(tokenRow?.value) || Boolean(envToken),
      telegramChatIdConfigured: Boolean(chatRow?.value) || Boolean(envChat),
      featureFlags: stored.featureFlags,
      revision: settingsRow?.revision ?? 1,
      updatedAt: settingsRow?.updatedAt.toISOString() ?? null,
      readOnly: {
        corsOriginsCount: this.config.get('CORS_ORIGINS', { infer: true })
          .length,
        workersEnabled: this.config.get('WORKERS_ENABLED', { infer: true }),
        backupDir: this.config.get('BACKUP_DIR', { infer: true }),
        backupRetentionDays: this.config.get('BACKUP_RETENTION_DAYS', {
          infer: true,
        }),
        backupEncrypt: this.config.get('BACKUP_ENCRYPT', { infer: true }),
        nodeEnv: this.config.get('NODE_ENV', { infer: true }),
        swaggerEnabled: this.config.get('SWAGGER_ENABLED', { infer: true }),
        subPublicBaseUrlEnv: envSub,
        vpnPublicHost:
          this.config.get('VPN_PUBLIC_HOST', { infer: true }) ?? null,
        acmeHttpPort: this.config.get('SING_BOX_ACME_HTTP_PORT', {
          infer: true,
        }),
        acmeTlsPort: this.config.get('SING_BOX_ACME_TLS_PORT', {
          infer: true,
        }),
        xrayListenPort: this.config.get('XRAY_LISTEN_PORT', { infer: true }),
        tlsCertificatePath:
          this.config.get('VPN_TLS_CERTIFICATE_PATH', { infer: true }) ?? null,
        tlsKeyPath:
          this.config.get('VPN_TLS_KEY_PATH', { infer: true }) ?? null,
        telegramEnvConfigured: Boolean(envToken) && Boolean(envChat),
      },
    };
  }

  private async loadStored(
    client: Pick<PrismaService, 'systemConfig'> = this.prisma,
  ): Promise<StoredSettings> {
    const row = await client.systemConfig.findUnique({
      where: { key: SETTINGS_KEY },
    });
    return parseStored(row?.value);
  }

  private async upsertSecret(
    tx: Pick<PrismaService, 'systemConfig'>,
    key: string,
    value: string | null,
    adminId: string,
    description: string,
  ): Promise<void> {
    if (value === null) {
      await tx.systemConfig.deleteMany({ where: { key } });
      return;
    }
    const encrypted = this.encryption.encrypt(value);
    const existing = await tx.systemConfig.findUnique({ where: { key } });
    const revision = (existing?.revision ?? 0) + 1;
    await tx.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: encrypted,
        description,
        isSecret: true,
        revision,
        updatedByAdminId: adminId,
      },
      update: {
        value: encrypted,
        isSecret: true,
        revision,
        updatedByAdminId: adminId,
      },
    });
  }
}

function parseStored(value: unknown): StoredSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultStored();
  }
  const record = value as Record<string, unknown>;
  const featureFlags =
    record.featureFlags &&
    typeof record.featureFlags === 'object' &&
    !Array.isArray(record.featureFlags)
      ? Object.fromEntries(
          Object.entries(record.featureFlags as Record<string, unknown>).filter(
            (entry): entry is [string, boolean] =>
              typeof entry[1] === 'boolean',
          ),
        )
      : {};
  return {
    panelUrl:
      typeof record.panelUrl === 'string'
        ? record.panelUrl
        : record.panelUrl === null
          ? null
          : null,
    subPublicBaseUrl:
      typeof record.subPublicBaseUrl === 'string'
        ? record.subPublicBaseUrl
        : null,
    profileUpdateIntervalHours:
      typeof record.profileUpdateIntervalHours === 'number'
        ? record.profileUpdateIntervalHours
        : null,
    notifyTelegramEnabled:
      typeof record.notifyTelegramEnabled === 'boolean'
        ? record.notifyTelegramEnabled
        : null,
    featureFlags,
  };
}

function redactSettings(settings: SystemSettings): Record<string, unknown> {
  return {
    panelUrl: settings.panelUrl,
    subPublicBaseUrl: settings.subPublicBaseUrl,
    profileUpdateIntervalHours: settings.profileUpdateIntervalHours,
    notifyTelegramEnabled: settings.notifyTelegramEnabled,
    telegramBotTokenConfigured: settings.telegramBotTokenConfigured,
    telegramChatIdConfigured: settings.telegramChatIdConfigured,
    featureFlags: settings.featureFlags,
    revision: settings.revision,
  };
}
