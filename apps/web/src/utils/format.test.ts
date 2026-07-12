import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildSubscriptionUrl, formatBytes, formatBytesPerSecond, truncateMiddle } from './format';

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
});

describe('truncateMiddle', () => {
  it('keeps short strings intact', () => {
    assert.equal(truncateMiddle('short'), 'short');
  });

  it('truncates long strings', () => {
    assert.equal(truncateMiddle('abcdefghijklmnopqrstuvwxyz', 4, 4), 'abcd…wxyz');
  });
});
