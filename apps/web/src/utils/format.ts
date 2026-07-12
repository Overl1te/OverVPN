const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** Format unsigned decimal byte strings (or numbers) for dense admin tables. */
export function formatBytes(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '—';
  }
  let n: bigint;
  try {
    n = typeof value === 'number' ? BigInt(Math.trunc(value)) : BigInt(value);
  } catch {
    return String(value);
  }
  if (n < 0n) {
    return String(value);
  }
  if (n < 1024n) {
    return `${n.toString()} B`;
  }
  let unit = 0;
  let scaled = Number(n);
  while (scaled >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${UNITS[unit]}`;
}

/** Format bytes/sec for throughput widgets. */
export function formatBytesPerSecond(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '—';
  }
  return `${formatBytes(value)}/s`;
}

/** Build a same-origin subscription URL from a token (admin copy helper). */
export function buildSubscriptionUrl(
  token: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/api/sub/${token}`;
}

export function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
