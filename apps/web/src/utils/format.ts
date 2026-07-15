import { buildSubscriptionPublicUrl } from '@overvpn/shared/constants';

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** Parse unsigned decimal byte strings (or numbers) to bigint; null if invalid/nullish. */
export function parseByteCount(value: string | number | null | undefined): bigint | null {
  if (value == null || value === '') {
    return null;
  }
  try {
    const n = typeof value === 'number' ? BigInt(Math.trunc(value)) : BigInt(value);
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

/** Format unsigned decimal byte strings (or numbers) for dense admin tables. */
export function formatBytes(value: string | number | null | undefined): string {
  const n = parseByteCount(value);
  if (n == null) {
    return value == null || value === '' ? '—' : String(value);
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

/** Sum two byte-count strings; returns string decimal. */
export function sumByteCounts(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): string {
  const a = parseByteCount(left) ?? 0n;
  const b = parseByteCount(right) ?? 0n;
  return (a + b).toString();
}

/**
 * Quota usage percent for Progress bars (0–100).
 * Returns null when there is no limit.
 */
export function usagePercent(
  used: string | number | null | undefined,
  limit: string | number | null | undefined,
): number | null {
  const usedN = parseByteCount(used);
  const limitN = parseByteCount(limit);
  if (usedN == null || limitN == null || limitN <= 0n) {
    return null;
  }
  if (usedN >= limitN) {
    return 100;
  }
  return Math.min(100, Number((usedN * 1000n) / limitN) / 10);
}

/** Remaining quota bytes as decimal string; null when unlimited. */
export function remainingBytes(
  used: string | number | null | undefined,
  limit: string | number | null | undefined,
): string | null {
  const usedN = parseByteCount(used);
  const limitN = parseByteCount(limit);
  if (usedN == null || limitN == null) {
    return null;
  }
  return (limitN > usedN ? limitN - usedN : 0n).toString();
}

/** Human duration between two ISO timestamps. */
export function formatDuration(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): string {
  if (!fromIso || !toIso) {
    return '—';
  }
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return '—';
  }
  const totalSec = Math.floor((to - from) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/** Build a subscription URL from a token and the configured public base URL. */
export function buildSubscriptionUrl(
  token: string,
  baseUrl: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  return buildSubscriptionPublicUrl(baseUrl, token);
}

export type SubscriptionClientLink = {
  id: 'happ' | 'hiddify' | 'clash' | 'v2rayng' | 'singbox';
  href: string;
};

/** Client deep links that wrap a HTTPS subscription URL for one-tap import. */
export function buildSubscriptionClientLinks(subscriptionUrl: string): SubscriptionClientLink[] {
  const encoded = encodeURIComponent(subscriptionUrl);
  return [
    // Happ expects the plain HTTPS URL after add/ (no encoding).
    { id: 'happ', href: `happ://add/${subscriptionUrl}` },
    { id: 'hiddify', href: `hiddify://import/${subscriptionUrl}` },
    { id: 'clash', href: `clash://install-config?url=${encoded}` },
    { id: 'v2rayng', href: `v2rayng://install-config?url=${encoded}` },
    { id: 'singbox', href: `sing-box://import-remote-profile?url=${encoded}` },
  ];
}

export function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
