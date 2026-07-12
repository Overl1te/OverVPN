import { createHash } from 'node:crypto';
import type { JsonObject, JsonValue } from './core-provider';

const sensitiveKeys = new Set([
  'password',
  'secret',
  'token',
  'api_token',
  'zone_token',
  'access_key_secret',
  'security_token',
  'mac_key',
  'private_key',
  'key',
  'certificate',
  'account_key',
  'credential',
]);

export function canonicalizeJson(value: JsonValue): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function redactJson(value: JsonValue, key?: string): JsonValue {
  if (key && isSensitiveKey(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJson(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        redactJson(nestedValue, nestedKey),
      ]),
    );
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      let changed = false;
      if (url.username || url.password) {
        url.username = '[REDACTED]';
        url.password = '[REDACTED]';
        changed = true;
      }
      for (const parameter of [...url.searchParams.keys()]) {
        if (isSensitiveKey(parameter)) {
          url.searchParams.set(parameter, '[REDACTED]');
          changed = true;
        }
      }
      if (changed) {
        return url.toString();
      }
    } catch {
      // Preserve non-URL strings. Schema validation handles desired config URLs.
    }
  }
  return value;
}

export function parseAndRedactJson(content: string): {
  value: JsonObject;
  canonical: string;
} {
  try {
    const parsed = JSON.parse(content) as JsonValue;
    const redacted = redactJson(parsed);
    if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
      throw new Error('Root is not an object');
    }
    return {
      value: redacted,
      canonical: canonicalizeJson(redacted),
    };
  } catch {
    const value: JsonObject = {
      error: 'Current configuration is not valid JSON',
    };
    return { value, canonical: canonicalizeJson(value) };
  }
}

export function redactText(
  value: string,
  secretValues: readonly string[],
): string {
  let result = value;
  const uniqueValues = [...new Set(secretValues)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const secret of uniqueValues) {
    const representations = new Set([
      secret,
      JSON.stringify(secret).slice(1, -1),
      ...(secret.length <= 1_024 ? [encodeURIComponent(secret)] : []),
    ]);
    for (const representation of representations) {
      result = result.split(representation).join('[REDACTED]');
    }
  }
  return result.replace(
    /\bv1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+\b/g,
    '[REDACTED_ENCRYPTED_VALUE]',
  );
}

export function unifiedDiff(
  current: string,
  desired: string,
  currentName = 'current',
  desiredName = 'desired',
): string {
  if (current === desired) {
    return `--- ${currentName}\n+++ ${desiredName}\n`;
  }
  const currentLines = withoutTrailingEmpty(current.split('\n'));
  const desiredLines = withoutTrailingEmpty(desired.split('\n'));
  const count = Math.max(currentLines.length, desiredLines.length);
  const body: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = currentLines[index];
    const after = desiredLines[index];
    if (before === after && before !== undefined) {
      body.push(` ${before}`);
      continue;
    }
    if (before !== undefined) {
      body.push(`-${before}`);
    }
    if (after !== undefined) {
      body.push(`+${after}`);
    }
  }
  return [
    `--- ${currentName}`,
    `+++ ${desiredName}`,
    `@@ -1,${currentLines.length} +1,${desiredLines.length} @@`,
    ...body,
    '',
  ].join('\n');
}

export function summarizeDiff(diff: string): {
  addedLines: number;
  removedLines: number;
  changed: boolean;
} {
  const lines = diff.split('\n').slice(2);
  const addedLines = lines.filter(
    (line) => line.startsWith('+') && !line.startsWith('+++'),
  ).length;
  const removedLines = lines.filter(
    (line) => line.startsWith('-') && !line.startsWith('---'),
  ).length;
  return {
    addedLines,
    removedLines,
    changed: addedLines > 0 || removedLines > 0,
  };
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    sensitiveKeys.has(normalized) ||
    normalized.endsWith('_password') ||
    normalized.endsWith('_secret') ||
    normalized.endsWith('_token') ||
    (normalized.endsWith('_key') &&
      normalized !== 'key_id' &&
      !normalized.endsWith('_key_path'))
  );
}

function withoutTrailingEmpty(lines: string[]): string[] {
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}
