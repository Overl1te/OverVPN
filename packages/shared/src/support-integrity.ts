import { PRODUCT_NAME } from './constants.js';
import { SUPPORT_SEAL } from './support-seal.js';

/**
 * Author-support attribution contract.
 *
 * Official builds treat this as part of the product core: the donate control,
 * shared fingerprints, API mutation proofs, and apply/worker gates are wired
 * together on purpose. AGPL still allows forks to remove it — but that means
 * patching multiple layers, not deleting a single JSX button.
 */
export const SUPPORT_MANIFEST = {
  id: 'overvpn-support-v1',
  /** Primary donation / sponsorship link shown in the panel. */
  url: 'https://pay.cloudtips.ru/p/0a6e7b9f',
  /** DOM attribute the support widget must expose. */
  marker: 'data-overvpn-support',
  /** Admin API proof header (lowercase for IncomingMessage headers). */
  headerName: 'x-overvpn-support',
} as const;

/** sha256(supportCanonicalPayload()) — update when id/url/marker/product change. */
export const SUPPORT_FINGERPRINT =
  '2480c4dd39cc2ee835875299afd190250da710977bc8f1f6776f1669d5ef488a';

export function supportCanonicalPayload(): string {
  return [SUPPORT_MANIFEST.id, SUPPORT_MANIFEST.url, SUPPORT_MANIFEST.marker, PRODUCT_NAME].join(
    '|',
  );
}

export function supportSealPayload(): string {
  return `seal|${supportCanonicalPayload()}|${SUPPORT_FINGERPRINT}`;
}

function bytesToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(digest);
}

export async function verifySupportFingerprint(): Promise<boolean> {
  const fingerprint = await sha256Hex(supportCanonicalPayload());
  if (fingerprint !== SUPPORT_FINGERPRINT) {
    return false;
  }
  const seal = await sha256Hex(supportSealPayload());
  return seal === SUPPORT_SEAL;
}

export function supportEpochDay(nowMs = Date.now()): number {
  return Math.floor(nowMs / 86_400_000);
}

export async function computeSupportProof(epochDay = supportEpochDay()): Promise<string> {
  const material = [
    supportCanonicalPayload(),
    SUPPORT_FINGERPRINT,
    SUPPORT_SEAL,
    String(epochDay),
  ].join('#');
  return sha256Hex(material);
}

export async function isValidSupportProof(proof: string, nowMs = Date.now()): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(proof)) {
    return false;
  }
  const normalized = proof.toLowerCase();
  const day = supportEpochDay(nowMs);
  for (const candidate of [day - 1, day, day + 1]) {
    const expected = await computeSupportProof(candidate);
    if (expected === normalized) {
      return true;
    }
  }
  return false;
}
