import { buildSubscriptionPublicUrl } from '@overvpn/shared/constants';

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
