/** Redact secrets before writing structured logs (mirrors audit.service). */

const sensitiveKeyPattern =
  /password|authorization|cookie|credential|secret|token|totp|private.?key|mac.?key|certificatepem|keypem|node.?token|install.?token/i;

export function redactLogData(value: unknown): unknown {
  return normalize(value);
}

function normalize(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        normalize(nestedValue, nestedKey),
      ]),
    );
  }
  if (
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value)
  ) {
    return value;
  }
  return value === undefined ? null : `[unsupported:${typeof value}]`;
}

export function shouldLogRequestBody(method: string | undefined): boolean {
  if (!method) {
    return false;
  }
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}
