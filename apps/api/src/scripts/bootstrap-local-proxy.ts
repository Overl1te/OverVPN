import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { LOCAL_PROXY_SERVER_ID } from '@overvpn/shared/constants';
import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';
import { PrismaClient, type Prisma } from '../generated/prisma/client';
import { NODE_TOKEN_SETTINGS_KEY } from '../proxy-servers/proxy-server-secrets';

loadEnvironment({ path: ['../../.env', '.env'], quiet: true });

const environmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be a PostgreSQL URL',
    ),
  SECRETS_MASTER_KEY: z.string().min(1),
  NODE_TOKEN: z.string().min(32).max(128),
  AGENT_BASE_URL: z.string().url().default('http://agent:7700'),
  LOCAL_PROXY_SERVER_ID: z.string().uuid().default(LOCAL_PROXY_SERVER_ID),
  LOCAL_PROXY_NAME: z.string().trim().min(1).max(100).default('local'),
});

function resolveMasterKey(configured: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new Error('SECRETS_MASTER_KEY did not decode to 32 bytes');
  }
  return key;
}

function encryptSecret(masterKey: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, ciphertext]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join(':');
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function bootstrapLocalProxy(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
  const masterKey = resolveMasterKey(environment.SECRETS_MASTER_KEY);
  const adapter = new PrismaPg({ connectionString: environment.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.proxyServer.findUnique({
      where: { id: environment.LOCAL_PROXY_SERVER_ID },
    });
    const settings: Record<string, unknown> =
      existing?.settings &&
      typeof existing.settings === 'object' &&
      !Array.isArray(existing.settings)
        ? { ...(existing.settings as Record<string, unknown>) }
        : {};
    settings[NODE_TOKEN_SETTINGS_KEY] = encryptSecret(
      masterKey,
      environment.NODE_TOKEN,
    );

    const row = await prisma.proxyServer.upsert({
      where: { id: environment.LOCAL_PROXY_SERVER_ID },
      create: {
        id: environment.LOCAL_PROXY_SERVER_ID,
        name: environment.LOCAL_PROXY_NAME,
        status: 'ONLINE',
        isLocal: true,
        agentBaseUrl: environment.AGENT_BASE_URL,
        nodeTokenHash: hashOpaqueToken(environment.NODE_TOKEN),
        lastSeenAt: new Date(),
        settings: settings as Prisma.InputJsonValue,
      },
      update: {
        name: environment.LOCAL_PROXY_NAME,
        status: 'ONLINE',
        isLocal: true,
        agentBaseUrl: environment.AGENT_BASE_URL,
        nodeTokenHash: hashOpaqueToken(environment.NODE_TOKEN),
        installTokenHash: null,
        installTokenExpiresAt: null,
        lastError: null,
        lastSeenAt: new Date(),
        settings: settings as Prisma.InputJsonValue,
      },
      select: { id: true, name: true, agentBaseUrl: true, status: true },
    });

    console.info(
      `Local proxy wired: ${row.name} (${row.id}) → ${row.agentBaseUrl} [${row.status}]`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

bootstrapLocalProxy().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown bootstrap error';
  console.error(`Failed to bootstrap local proxy: ${message}`);
  process.exitCode = 1;
});
