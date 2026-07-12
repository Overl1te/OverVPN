import { z } from 'zod';

const booleanFromEnvironment = z.preprocess((value: unknown) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }

  return value;
}, z.boolean());

const corsOriginsSchema = z
  .string()
  .default('http://localhost:5173')
  .transform((value, context) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (origins.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'CORS_ORIGINS must include at least one origin',
      });
      return z.NEVER;
    }

    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.origin !== origin
        ) {
          throw new Error(
            'Origin must contain only scheme, host, and optional port',
          );
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: `Invalid CORS origin: ${origin}`,
        });
      }
    }

    return origins;
  });

const masterKeySchema = z.string().refine((value) => {
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return true;
  }

  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}, 'SECRETS_MASTER_KEY must be 32 bytes encoded as 64 hex characters or base64');

const insecureSecretPattern =
  /replace|change[-_ ]?me|development|example|default|secret/i;

const publicBaseUrlSchema = z
  .url()
  .transform((value) => value.replace(/\/+$/, ''))
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '' || url.pathname === '/')
    );
  }, 'SUB_PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment');

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) =>
          value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must be a PostgreSQL URL',
      ),
    REDIS_URL: z
      .string()
      .min(1)
      .refine(
        (value) =>
          value.startsWith('redis://') || value.startsWith('rediss://'),
        {
          message: 'REDIS_URL must be a Redis URL',
        },
      ),
    CORS_ORIGINS: corsOriginsSchema,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanFromEnvironment.default(false),
    SWAGGER_ENABLED: booleanFromEnvironment.default(true),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3_600)
      .default(900),
    JWT_ISSUER: z.string().min(1).max(128).default('overvpn'),
    JWT_AUDIENCE: z.string().min(1).max(128).default('overvpn-admin'),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(31_536_000)
      .default(2_592_000),
    SECRETS_MASTER_KEY: masterKeySchema,
    TOTP_ISSUER: z.string().trim().min(1).max(64).default('OverVPN'),
    AUTH_COOKIE_NAME: z
      .string()
      .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
      .default('overvpn_refresh'),
    AUTH_COOKIE_SECURE: booleanFromEnvironment.default(true),
    AUTH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
    AUTH_COOKIE_DOMAIN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    AUTH_COOKIE_PATH: z.string().startsWith('/').default('/api/admin/auth'),
    LOGIN_THROTTLE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(5),
    LOGIN_THROTTLE_TTL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    SUB_PUBLIC_BASE_URL: publicBaseUrlSchema,
    SUB_PROFILE_UPDATE_INTERVAL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(6),
    SUB_RATE_LIMIT_IP_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(60),
    SUB_RATE_LIMIT_TOKEN_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(100_000)
      .default(120),
    SUB_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_600)
      .default(60),
    SING_BOX_BINARY_PATH: z.string().trim().min(1).default('sing-box'),
    SING_BOX_CONFIG_PATH: z
      .string()
      .trim()
      .min(1)
      .default('/var/lib/sing-box/config.json'),
    SING_BOX_LAST_KNOWN_GOOD_PATH: z
      .string()
      .trim()
      .min(1)
      .default('/var/lib/sing-box/config.last-known-good.json'),
    SING_BOX_RELOAD_REQUEST_PATH: z
      .string()
      .trim()
      .min(1)
      .default('/var/lib/overvpn/reload/request'),
    SING_BOX_RELOAD_ACK_PATH: z
      .string()
      .trim()
      .min(1)
      .default('/var/lib/overvpn/reload/ack'),
    SING_BOX_CLASH_API_URL: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      }, 'SING_BOX_CLASH_API_URL must use HTTP or HTTPS without embedded credentials')
      .default('http://127.0.0.1:9090'),
    SING_BOX_CLASH_API_LISTEN: z
      .string()
      .trim()
      .min(3)
      .max(255)
      .default('0.0.0.0:9090'),
    SING_BOX_CLASH_API_SECRET: z.string().min(32).max(512),
    SING_BOX_V2RAY_API_LISTEN: z
      .string()
      .trim()
      .min(3)
      .max(255)
      .default('0.0.0.0:8080'),
    SING_BOX_V2RAY_API_ADDRESS: z
      .string()
      .trim()
      .min(3)
      .max(255)
      .default('127.0.0.1:8080'),
    SING_BOX_PROCESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(15_000),
    SING_BOX_RELOAD_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(20_000),
    SING_BOX_HEALTH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(60_000)
      .default(5_000),
    CORE_APPLY_LOCK_TTL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(600_000)
      .default(60_000),
    WORKERS_ENABLED: booleanFromEnvironment.default(false),
    WORKER_LOCK_TTL_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(600_000)
      .default(60_000),
    TRAFFIC_COLLECTION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(15_000),
    TRAFFIC_AGGREGATION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    TRAFFIC_AGGREGATION_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(1_000),
    TRAFFIC_LEDGER_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_650)
      .default(90),
    ONLINE_COLLECTION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(15_000),
    ONLINE_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(30_000),
    ONLINE_SESSION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(86_400_000)
      .default(90_000),
    ONLINE_SESSION_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_650)
      .default(30),
    ENFORCEMENT_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(30_000),
    TELEGRAM_ENABLED: booleanFromEnvironment.default(false),
    TELEGRAM_BOT_TOKEN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Invalid Telegram bot token')
        .optional(),
    ),
    TELEGRAM_CHAT_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(
          /^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,31})$/,
          'Invalid Telegram chat id',
        )
        .optional(),
    ),
    TELEGRAM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(30_000)
      .default(5_000),
    BACKUP_DIR: z.string().trim().min(1).default('/var/lib/overvpn/backups'),
    BACKUP_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3_650)
      .default(30),
    BACKUP_ENCRYPT: booleanFromEnvironment.default(true),
    BACKUP_PROCESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(3_600_000)
      .default(600_000),
  })
  .superRefine((value, context) => {
    if (value.AUTH_COOKIE_SAME_SITE === 'none' && !value.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'SameSite=None cookies must be Secure',
      });
    }

    if (value.TELEGRAM_ENABLED) {
      if (!value.TELEGRAM_BOT_TOKEN) {
        context.addIssue({
          code: 'custom',
          path: ['TELEGRAM_BOT_TOKEN'],
          message: 'TELEGRAM_BOT_TOKEN is required when Telegram is enabled',
        });
      }
      if (!value.TELEGRAM_CHAT_ID) {
        context.addIssue({
          code: 'custom',
          path: ['TELEGRAM_CHAT_ID'],
          message: 'TELEGRAM_CHAT_ID is required when Telegram is enabled',
        });
      }
    }

    if (value.NODE_ENV !== 'production') {
      return;
    }

    if (!value.SUB_PUBLIC_BASE_URL.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['SUB_PUBLIC_BASE_URL'],
        message: 'Production subscription URLs must use HTTPS',
      });
    }

    for (const field of [
      'JWT_ACCESS_SECRET',
      'SECRETS_MASTER_KEY',
      'SING_BOX_CLASH_API_SECRET',
    ] as const) {
      if (insecureSecretPattern.test(value[field])) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must be a strong production secret`,
        });
      }
    }
    if (new Set(value.JWT_ACCESS_SECRET).size < 12) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET does not have enough character diversity',
      });
    }
    if (new Set(value.SING_BOX_CLASH_API_SECRET).size < 12) {
      context.addIssue({
        code: 'custom',
        path: ['SING_BOX_CLASH_API_SECRET'],
        message:
          'SING_BOX_CLASH_API_SECRET does not have enough character diversity',
      });
    }
    const decodedMasterKey = /^[0-9a-f]{64}$/i.test(value.SECRETS_MASTER_KEY)
      ? Buffer.from(value.SECRETS_MASTER_KEY, 'hex')
      : Buffer.from(value.SECRETS_MASTER_KEY, 'base64');
    if (new Set(decodedMasterKey).size < 12) {
      context.addIssue({
        code: 'custom',
        path: ['SECRETS_MASTER_KEY'],
        message: 'SECRETS_MASTER_KEY does not have enough byte diversity',
      });
    }

    if (!value.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'Production authentication cookies must be Secure',
      });
    }
  });

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): AppEnvironment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    throw new Error(
      `Environment validation failed:\n${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}
