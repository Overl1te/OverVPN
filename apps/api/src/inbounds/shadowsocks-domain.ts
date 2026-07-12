import { randomBytes } from 'node:crypto';
import type {
  ShadowsocksInboundPublicConfig,
  ShadowsocksInboundSettings,
  ShadowsocksMethod,
} from '@overvpn/shared/schemas';
import type {
  PasswordCredential,
  ShadowsocksInboundSecrets,
} from '../core/core-provider';
import {
  formatUriHost,
  hasControlCharacter,
  rfc3986,
} from './share-link-utils';

export interface ShadowsocksStorage {
  publicConfig: ShadowsocksInboundPublicConfig;
  secrets: ShadowsocksInboundSecrets;
}

export function isShadowsocks2022Method(method: ShadowsocksMethod): boolean {
  return (
    method === '2022-blake3-aes-128-gcm' || method === '2022-blake3-aes-256-gcm'
  );
}

export function shadowsocks2022ByteLength(
  method: ShadowsocksMethod,
): 16 | 32 | null {
  if (method === '2022-blake3-aes-128-gcm') return 16;
  if (method === '2022-blake3-aes-256-gcm') return 32;
  return null;
}

export function generateShadowsocksPassword(method: ShadowsocksMethod): string {
  const byteLength = shadowsocks2022ByteLength(method);
  if (byteLength) {
    return randomBytes(byteLength).toString('base64');
  }
  return randomBytes(32).toString('base64url');
}

export function normalizeShadowsocksPassword(
  method: ShadowsocksMethod,
  supplied: string | undefined,
): string {
  const password = supplied ?? generateShadowsocksPassword(method);
  const byteLength = shadowsocks2022ByteLength(method);
  if (byteLength) {
    const decoded = decodeBase64(password);
    if (!decoded || decoded.byteLength !== byteLength) {
      throw new Error(
        `Shadowsocks ${method} passwords must be base64 of exactly ${byteLength} bytes`,
      );
    }
    return password;
  }
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < 8 || bytes > 128 || hasControlCharacter(password)) {
    throw new Error(
      'Classic Shadowsocks passwords must be 8-128 UTF-8 bytes without control characters',
    );
  }
  return password;
}

export function createShadowsocksCredential(
  method: ShadowsocksMethod,
  password?: string,
): PasswordCredential {
  return {
    version: 1,
    password: normalizeShadowsocksPassword(method, password),
  };
}

export function buildShadowsocksStorage(
  settings: ShadowsocksInboundSettings,
  previous?: ShadowsocksStorage,
): ShadowsocksStorage {
  const serverPassword = normalizeShadowsocksPassword(
    settings.method,
    settings.password ?? previous?.secrets.serverPassword,
  );
  return {
    publicConfig: {
      method: settings.method,
      passwordPresent: true,
    },
    secrets: {
      version: 1,
      serverPassword,
    },
  };
}

export function composeShadowsocksClientPassword(
  method: ShadowsocksMethod,
  serverPassword: string,
  userPassword: string,
): string {
  if (isShadowsocks2022Method(method)) {
    return `${serverPassword}:${userPassword}`;
  }
  return userPassword;
}

export function buildShadowsocksUri(input: {
  method: ShadowsocksMethod;
  password: string;
  host: string;
  port: number;
  label: string;
}): string {
  const host = formatUriHost(input.host);
  const userInfo = Buffer.from(
    `${input.method}:${input.password}`,
    'utf8',
  ).toString('base64');
  return `ss://${userInfo}@${host}:${input.port}#${rfc3986(input.label)}`;
}

function decodeBase64(value: string): Buffer | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64');
    return decoded.byteLength > 0 ? decoded : null;
  } catch {
    return null;
  }
}
