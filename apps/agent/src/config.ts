import { homedir, hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_AGENT_LISTEN_PORT,
  DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
} from '@overvpn/shared/constants';
import { z } from 'zod';

const booleanish = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
});

const positiveInt = z.coerce.number().int().positive();

/** Compose often passes empty strings for optional secrets. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const environmentSchema = z
  .object({
    PANEL_URL: z.string().url(),
    NODE_ID: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    NODE_TOKEN: z.preprocess(emptyToUndefined, z.string().min(32).max(128).optional()),
    INSTALL_TOKEN: z.preprocess(emptyToUndefined, z.string().min(16).max(256).optional()),
    AGENT_LISTEN: z.string().trim().min(1).default(String(DEFAULT_AGENT_LISTEN_PORT)),
    AGENT_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
    AGENT_HOSTNAME: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(255).optional()),
    AGENT_VERSION: z.string().trim().min(1).max(64).optional(),
    AGENT_STATE_PATH: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    HEARTBEAT_INTERVAL_SEC: positiveInt.default(DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC),
    PULL_DESIRED_ENABLED: booleanish.default(true),
    SKIP_CORE_RELOAD: booleanish.default(false),
    PANEL_TIMEOUT_MS: positiveInt.default(15_000),

    SING_BOX_CONFIG_PATH: z.string().default('/var/lib/sing-box/config.json'),
    SING_BOX_LAST_KNOWN_GOOD_PATH: z
      .string()
      .default('/var/lib/sing-box/config.last-known-good.json'),
    SING_BOX_RELOAD_REQUEST_PATH: z.string().default('/var/lib/overvpn/reload/request'),
    SING_BOX_RELOAD_ACK_PATH: z.string().default('/var/lib/overvpn/reload/ack'),
    SING_BOX_RELOAD_TIMEOUT_MS: positiveInt.default(20_000),
    SING_BOX_PID_PATH: z.string().default('/var/lib/overvpn/reload/sing-box.pid'),

    XRAY_CONFIG_PATH: z.string().default('/var/lib/xray/config.json'),
    XRAY_LAST_KNOWN_GOOD_PATH: z.string().default('/var/lib/xray/config.last-known-good.json'),
    XRAY_RELOAD_REQUEST_PATH: z.string().default('/var/lib/overvpn/xray-reload/request'),
    XRAY_RELOAD_ACK_PATH: z.string().default('/var/lib/overvpn/xray-reload/ack'),
    XRAY_RELOAD_TIMEOUT_MS: positiveInt.default(20_000),
    XRAY_PID_PATH: z.string().default('/var/lib/overvpn/xray-reload/xray.pid'),

    MTPROXY_CONFIG_PATH: z.string().default('/var/lib/mtproxy/config.json'),
    MTPROXY_LAST_KNOWN_GOOD_PATH: z
      .string()
      .default('/var/lib/mtproxy/config.last-known-good.json'),
    MTPROXY_RELOAD_REQUEST_PATH: z.string().default('/var/lib/overvpn/mtproxy-reload/request'),
    MTPROXY_RELOAD_ACK_PATH: z.string().default('/var/lib/overvpn/mtproxy-reload/ack'),
    MTPROXY_RELOAD_TIMEOUT_MS: positiveInt.default(20_000),
    MTPROXY_PID_PATH: z.string().default('/var/lib/overvpn/mtproxy-reload/mtproxy.pid'),
  })
  .superRefine((value, ctx) => {
    if (!value.NODE_TOKEN && !value.INSTALL_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        message: 'Either NODE_TOKEN or INSTALL_TOKEN is required',
        path: ['NODE_TOKEN'],
      });
    }
    if (!value.NODE_ID) {
      ctx.addIssue({
        code: 'custom',
        message: 'NODE_ID (proxy server UUID) is required for panel routes',
        path: ['NODE_ID'],
      });
    }
  });

export type AgentEnvironment = z.infer<typeof environmentSchema>;

export type ListenTarget = {
  host: string;
  port: number;
};

export type EnginePaths = {
  configPath: string;
  lastKnownGoodPath: string;
  reloadRequestPath: string;
  reloadAckPath: string;
  reloadTimeoutMs: number;
  pidPath: string;
};

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AgentEnvironment {
  return environmentSchema.parse(env);
}

export function parseListenTarget(value: string): ListenTarget {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return { host: '0.0.0.0', port: Number(trimmed) };
  }
  const match = trimmed.match(/^(?:\[(?<ipv6>[^\]]+)\]|(?<host>[^:]+)):(?<port>\d+)$/);
  if (!match?.groups?.port) {
    throw new Error(`Invalid AGENT_LISTEN "${value}" (expected PORT or HOST:PORT)`);
  }
  return {
    host: match.groups.ipv6 ?? match.groups.host ?? '0.0.0.0',
    port: Number(match.groups.port),
  };
}

export function resolveAgentHostname(env: AgentEnvironment): string {
  return env.AGENT_HOSTNAME ?? osHostname();
}

export function resolveAgentVersion(env: AgentEnvironment): string {
  return env.AGENT_VERSION ?? process.env.npm_package_version ?? '0.1.0';
}

export function resolveStatePath(env: AgentEnvironment): string {
  return env.AGENT_STATE_PATH ?? join(homedir(), '.overvpn', 'agent-state.json');
}

export function enginePathsFor(
  env: AgentEnvironment,
  engine: 'SING_BOX' | 'XRAY' | 'MTPROXY',
): EnginePaths {
  switch (engine) {
    case 'SING_BOX':
      return {
        configPath: env.SING_BOX_CONFIG_PATH,
        lastKnownGoodPath: env.SING_BOX_LAST_KNOWN_GOOD_PATH,
        reloadRequestPath: env.SING_BOX_RELOAD_REQUEST_PATH,
        reloadAckPath: env.SING_BOX_RELOAD_ACK_PATH,
        reloadTimeoutMs: env.SING_BOX_RELOAD_TIMEOUT_MS,
        pidPath: env.SING_BOX_PID_PATH,
      };
    case 'XRAY':
      return {
        configPath: env.XRAY_CONFIG_PATH,
        lastKnownGoodPath: env.XRAY_LAST_KNOWN_GOOD_PATH,
        reloadRequestPath: env.XRAY_RELOAD_REQUEST_PATH,
        reloadAckPath: env.XRAY_RELOAD_ACK_PATH,
        reloadTimeoutMs: env.XRAY_RELOAD_TIMEOUT_MS,
        pidPath: env.XRAY_PID_PATH,
      };
    case 'MTPROXY':
      return {
        configPath: env.MTPROXY_CONFIG_PATH,
        lastKnownGoodPath: env.MTPROXY_LAST_KNOWN_GOOD_PATH,
        reloadRequestPath: env.MTPROXY_RELOAD_REQUEST_PATH,
        reloadAckPath: env.MTPROXY_RELOAD_ACK_PATH,
        reloadTimeoutMs: env.MTPROXY_RELOAD_TIMEOUT_MS,
        pidPath: env.MTPROXY_PID_PATH,
      };
  }
}

export function joinPanelUrl(panelUrl: string, path: string): string {
  const base = panelUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Panel hybrid routes: `/api/agent/nodes/:id/...` */
export function panelNodePath(
  nodeId: string,
  action: 'register' | 'heartbeat' | 'desired' | 'stats' | 'apply-result',
): string {
  return `/api/agent/nodes/${nodeId}/${action}`;
}
