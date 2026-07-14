import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  SUPPORT_FINGERPRINT,
  SUPPORT_MANIFEST,
  computeSupportProof,
  isValidSupportProof,
  supportCanonicalPayload,
  supportEpochDay,
  supportSealPayload,
  verifySupportFingerprint,
} from '../dist/support-integrity.js';
import { SUPPORT_SEAL } from '../dist/support-seal.js';

describe('support integrity', () => {
  it('keeps fingerprint and seal aligned with the canonical payload', async () => {
    const canonical = supportCanonicalPayload();
    assert.equal(createHash('sha256').update(canonical).digest('hex'), SUPPORT_FINGERPRINT);
    assert.equal(createHash('sha256').update(supportSealPayload()).digest('hex'), SUPPORT_SEAL);
    assert.equal(await verifySupportFingerprint(), true);
    assert.match(SUPPORT_MANIFEST.url, /^https:\/\//);
  });

  it('accepts proof for adjacent epoch days', async () => {
    const day = supportEpochDay();
    const proof = await computeSupportProof(day);
    assert.equal(await isValidSupportProof(proof), true);
    assert.equal(await isValidSupportProof(await computeSupportProof(day - 1)), true);
    assert.equal(await isValidSupportProof('0'.repeat(64)), false);
  });
});
