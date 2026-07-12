import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';
import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';
import { PrismaClient } from '../generated/prisma/client';

loadEnvironment({ path: ['../../.env', '.env'], quiet: true });

const bootstrapEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be a PostgreSQL URL',
    ),
  BOOTSTRAP_ADMIN_USER: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(16).max(256),
});

async function bootstrapAdmin(): Promise<void> {
  const environment = bootstrapEnvironmentSchema.parse(process.env);
  const adapter = new PrismaPg({ connectionString: environment.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const username = environment.BOOTSTRAP_ADMIN_USER.toLowerCase();
    const passwordHash = await hash(environment.BOOTSTRAP_ADMIN_PASSWORD, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
    });

    const admin = await prisma.adminUser.upsert({
      where: { username },
      create: {
        username,
        passwordHash,
        role: 'OWNER',
        locale: 'RU',
        active: true,
      },
      update: {
        passwordHash,
        role: 'OWNER',
        active: true,
      },
      select: {
        id: true,
        username: true,
      },
    });

    console.info(`Bootstrap owner is ready: ${admin.username} (${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrapAdmin().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown bootstrap error';
  console.error(`Failed to bootstrap owner: ${message}`);
  process.exitCode = 1;
});
