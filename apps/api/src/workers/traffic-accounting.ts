import { createHash } from 'node:crypto';
import { MAX_SIGNED_BIGINT } from '@overvpn/shared/constants';

export interface TrafficCursorState {
  lastUploadBytes: bigint;
  lastDownloadBytes: bigint;
  accountingEpoch: number;
  generation: number;
}

export interface TrafficDeltaComputation {
  baseline: boolean;
  counterReset: boolean;
  uploadDelta: bigint;
  downloadDelta: bigint;
  generation: number;
  sampleKey: string;
}

export function parseNonnegativeInt64(value: string): bigint | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed <= MAX_SIGNED_BIGINT ? parsed : null;
  } catch {
    return null;
  }
}

export function checkedByteSum(left: bigint, right: bigint): bigint {
  const result = left + right;
  if (left < 0n || right < 0n || result > MAX_SIGNED_BIGINT) {
    throw new Error('Traffic accounting exceeds signed 64-bit storage');
  }
  return result;
}

export function computeTrafficDelta(
  statsKey: string,
  accountingEpoch: number,
  uploadBytes: bigint,
  downloadBytes: bigint,
  cursor: TrafficCursorState | null,
): TrafficDeltaComputation {
  if (
    accountingEpoch < 0 ||
    uploadBytes < 0n ||
    downloadBytes < 0n ||
    uploadBytes > MAX_SIGNED_BIGINT ||
    downloadBytes > MAX_SIGNED_BIGINT
  ) {
    throw new Error('Invalid traffic sample');
  }

  const firstObservation = cursor === null;
  const epochChanged =
    cursor !== null && cursor.accountingEpoch !== accountingEpoch;
  const baseline = firstObservation || epochChanged;
  const counterReset =
    cursor !== null &&
    !epochChanged &&
    (uploadBytes < cursor.lastUploadBytes ||
      downloadBytes < cursor.lastDownloadBytes);
  const generation =
    cursor === null
      ? 0
      : cursor.generation + (epochChanged || counterReset ? 1 : 0);
  const uploadDelta = baseline
    ? 0n
    : counterReset
      ? uploadBytes
      : uploadBytes - cursor.lastUploadBytes;
  const downloadDelta = baseline
    ? 0n
    : counterReset
      ? downloadBytes
      : downloadBytes - cursor.lastDownloadBytes;
  const sampleKey = createHash('sha256')
    .update(
      [
        statsKey,
        accountingEpoch.toString(),
        generation.toString(),
        uploadBytes.toString(),
        downloadBytes.toString(),
      ].join('\0'),
    )
    .digest('hex');

  return {
    baseline,
    counterReset,
    uploadDelta,
    downloadDelta,
    generation,
    sampleKey,
  };
}
