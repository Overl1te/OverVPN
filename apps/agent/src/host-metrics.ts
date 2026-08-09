import { readFileSync } from 'node:fs';
import * as os from 'node:os';

export type CpuSample = {
  idle: number;
  total: number;
};

export type MemorySample = {
  totalBytes: bigint;
  availableBytes: bigint;
};

export type NetworkSample = {
  inboundBytes: bigint;
  outboundBytes: bigint;
};

const SKIP_NET_IFACES = new Set(['lo', 'lo0']);

/** Parse aggregate idle/total jiffies from Linux `/proc/stat` `cpu` line. */
export function parseProcStat(content: string): CpuSample | null {
  const line = content.split('\n').find((row) => row.startsWith('cpu '));
  if (!line) {
    return null;
  }
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return null;
  }
  return { idle, total };
}

/** Parse MemTotal / MemAvailable (fallback MemFree+Buffers+Cached) from `/proc/meminfo`. */
export function parseProcMeminfo(content: string): MemorySample | null {
  const values = new Map<string, bigint>();
  for (const line of content.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s+kB\s*$/.exec(line);
    if (!match) {
      continue;
    }
    values.set(match[1], BigInt(match[2]) * 1024n);
  }
  const total = values.get('MemTotal');
  if (total === undefined || total <= 0n) {
    return null;
  }
  let available = values.get('MemAvailable');
  if (available === undefined) {
    const free = values.get('MemFree') ?? 0n;
    const buffers = values.get('Buffers') ?? 0n;
    const cached = values.get('Cached') ?? 0n;
    available = free + buffers + cached;
  }
  if (available < 0n) {
    available = 0n;
  }
  if (available > total) {
    available = total;
  }
  return { totalBytes: total, availableBytes: available };
}

/**
 * Sum rx/tx bytes across non-loopback interfaces from `/proc/net/dev`.
 * Host bind-mount of `/proc` yields host NIC counters inside Docker.
 */
export function parseProcNetDev(content: string): NetworkSample | null {
  let inboundBytes = 0n;
  let outboundBytes = 0n;
  let matched = false;
  for (const line of content.split('\n')) {
    const match =
      /^\s*([A-Za-z0-9._-]+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+/.exec(
        line,
      );
    if (!match) {
      continue;
    }
    const iface = match[1];
    if (SKIP_NET_IFACES.has(iface) || iface.startsWith('docker') || iface.startsWith('veth')) {
      continue;
    }
    inboundBytes += BigInt(match[2]);
    outboundBytes += BigInt(match[3]);
    matched = true;
  }
  return matched ? { inboundBytes, outboundBytes } : null;
}

export function cpuUsagePercent(previous: CpuSample | null, current: CpuSample): number {
  if (!previous || current.total <= previous.total) {
    return 0;
  }
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) {
    return 0;
  }
  const busy = 1 - idleDelta / totalDelta;
  return Math.min(100, Math.max(0, Math.round(busy * 1000) / 10));
}

export function memoryFromOs(): MemorySample {
  const totalBytes = BigInt(os.totalmem());
  const availableBytes = BigInt(os.freemem());
  return { totalBytes, availableBytes };
}

export function cpuSampleFromOs(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function readCpuSample(procRoot: string): CpuSample {
  const content = readTextFile(`${procRoot}/stat`);
  if (content) {
    const parsed = parseProcStat(content);
    if (parsed) {
      return parsed;
    }
  }
  return cpuSampleFromOs();
}

export function readMemorySample(procRoot: string): MemorySample {
  const content = readTextFile(`${procRoot}/meminfo`);
  if (content) {
    const parsed = parseProcMeminfo(content);
    if (parsed) {
      return parsed;
    }
  }
  return memoryFromOs();
}

export function readNetworkSample(procRoot: string): NetworkSample | null {
  const content = readTextFile(`${procRoot}/net/dev`);
  if (!content) {
    return null;
  }
  return parseProcNetDev(content);
}

export function networkRatesPerSecond(
  previous: { sample: NetworkSample; atMs: number } | null,
  current: NetworkSample,
  atMs: number,
): { inboundBytesPerSecond: bigint; outboundBytesPerSecond: bigint } {
  if (!previous || atMs <= previous.atMs) {
    return { inboundBytesPerSecond: 0n, outboundBytesPerSecond: 0n };
  }
  const elapsedSec = (atMs - previous.atMs) / 1000;
  if (elapsedSec <= 0) {
    return { inboundBytesPerSecond: 0n, outboundBytesPerSecond: 0n };
  }
  const inboundDelta =
    current.inboundBytes >= previous.sample.inboundBytes
      ? current.inboundBytes - previous.sample.inboundBytes
      : 0n;
  const outboundDelta =
    current.outboundBytes >= previous.sample.outboundBytes
      ? current.outboundBytes - previous.sample.outboundBytes
      : 0n;
  return {
    inboundBytesPerSecond: BigInt(Math.round(Number(inboundDelta) / elapsedSec)),
    outboundBytesPerSecond: BigInt(Math.round(Number(outboundDelta) / elapsedSec)),
  };
}

export function memoryPercent(totalBytes: bigint, availableBytes: bigint): number {
  if (totalBytes <= 0n) {
    return 0;
  }
  const used = totalBytes > availableBytes ? totalBytes - availableBytes : 0n;
  return Math.min(100, Math.max(0, Math.round(Number((used * 1000n) / totalBytes) / 10)));
}
