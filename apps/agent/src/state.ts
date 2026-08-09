import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const agentStateSchema = z
  .object({
    proxyServerId: z.string().uuid().optional(),
    nodeToken: z.string().min(32).max(128).optional(),
    heartbeatIntervalSec: z.number().int().positive().optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

export type AgentState = z.infer<typeof agentStateSchema>;

export async function loadAgentState(path: string): Promise<AgentState> {
  try {
    const raw = await readFile(path, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    return agentStateSchema.parse(JSON.parse(trimmed) as unknown);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      return {};
    }
    throw error;
  }
}

export async function saveAgentState(path: string, state: AgentState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload: AgentState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}
