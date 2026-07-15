import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  buildSubscriptionClientLinks,
  buildSubscriptionUrl,
  formatBytes,
  formatBytesPerSecond,
  formatDuration,
  remainingBytes,
  sumByteCounts,
  truncateMiddle,
  usagePercent,
} from './format';

describe('formatBytes', () => {
  it('formats small and large values', () => {
    assert.equal(formatBytes('0'), '0 B');
    assert.equal(formatBytes('512'), '512 B');
    assert.equal(formatBytes('1024'), '1.00 KiB');
    assert.equal(formatBytes('1073741824'), '1.00 GiB');
  });

  it('handles nullish', () => {
    assert.equal(formatBytes(null), '—');
    assert.equal(formatBytes(undefined), '—');
  });
});

describe('formatBytesPerSecond', () => {
  it('appends /s', () => {
    assert.equal(formatBytesPerSecond('2048'), '2.00 KiB/s');
  });
});

describe('sumByteCounts', () => {
  it('sums upload and download', () => {
    assert.equal(sumByteCounts('100', '50'), '150');
    assert.equal(sumByteCounts(null, '50'), '50');
  });
});

describe('usagePercent', () => {
  it('returns null without a limit', () => {
    assert.equal(usagePercent('100', null), null);
  });

  it('computes percent with one decimal of precision', () => {
    assert.equal(usagePercent('50', '100'), 50);
    assert.equal(usagePercent('1', '3'), 33.3);
    assert.equal(usagePercent('100', '100'), 100);
    assert.equal(usagePercent('200', '100'), 100);
  });
});

describe('remainingBytes', () => {
  it('returns remaining or zero when over quota', () => {
    assert.equal(remainingBytes('40', '100'), '60');
    assert.equal(remainingBytes('150', '100'), '0');
    assert.equal(remainingBytes('40', null), null);
  });
});

describe('formatDuration', () => {
  it('formats durations', () => {
    assert.equal(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T01:30:05.000Z'), '1h 30m');
    assert.equal(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:02:05.000Z'), '2m 5s');
  });
});

describe('buildSubscriptionUrl', () => {
  it('joins origin and token via /api/sub', () => {
    assert.equal(
      buildSubscriptionUrl('abc', 'https://panel.example.com'),
      'https://panel.example.com/api/sub/abc',
    );
  });

  it('uses custom path when present', () => {
    assert.equal(
      buildSubscriptionUrl('abc', 'https://example.com/sub'),
      'https://example.com/sub/abc',
    );
  });

  it('prefers the configured subscription base host', () => {
    assert.equal(
      buildSubscriptionUrl('abc', 'https://sub.example.com'),
      'https://sub.example.com/api/sub/abc',
    );
  });
});

describe('buildSubscriptionClientLinks', () => {
  it('builds known client deep links', () => {
    const url = 'https://sub.example.com/api/sub/token';
    const links = buildSubscriptionClientLinks(url);
    assert.deepEqual(
      links.map((link) => link.id),
      ['happ', 'hiddify', 'clash', 'v2rayng', 'singbox'],
    );
    assert.equal(links[0]?.href, `happ://add/${url}`);
    assert.equal(links[1]?.href, `hiddify://import/${url}`);
    assert.equal(links[2]?.href, `clash://install-config?url=${encodeURIComponent(url)}`);
  });
});

describe('truncateMiddle', () => {
  it('keeps short strings intact', () => {
    assert.equal(truncateMiddle('short'), 'short');
  });

  it('truncates long strings', () => {
    assert.equal(truncateMiddle('abcdefghijklmnopqrstuvwxyz', 4, 4), 'abcd…wxyz');
  });
});
