import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cpuUsagePercent,
  memoryPercent,
  networkRatesPerSecond,
  parseProcMeminfo,
  parseProcNetDev,
  parseProcStat,
} from './host-metrics.js';
import { HostLoadSampler } from './host-load-sampler.js';

describe('agent host-metrics parsers', () => {
  it('parses /proc/stat cpu jiffies', () => {
    const sample = parseProcStat(
      ['cpu  100 20 30 400 10 0 0 0 0 0', 'cpu0 50 10 15 200 5 0 0 0 0 0', ''].join('\n'),
    );
    assert.deepEqual(sample, { idle: 410, total: 560 });
  });

  it('computes cpu usage percent between samples', () => {
    const previous = { idle: 400, total: 500 };
    const current = { idle: 450, total: 600 };
    assert.equal(cpuUsagePercent(previous, current), 50);
    assert.equal(cpuUsagePercent(null, current), 0);
  });

  it('parses /proc/meminfo with MemAvailable', () => {
    const sample = parseProcMeminfo(
      [
        'MemTotal:       16384000 kB',
        'MemFree:         2048000 kB',
        'MemAvailable:    8192000 kB',
        'Buffers:          512000 kB',
        'Cached:          4096000 kB',
      ].join('\n'),
    );
    assert.equal(sample?.totalBytes, 16384000n * 1024n);
    assert.equal(sample?.availableBytes, 8192000n * 1024n);
  });

  it('computes memory percent', () => {
    assert.equal(memoryPercent(1000n, 250n), 75);
    assert.equal(memoryPercent(0n, 0n), 0);
  });

  it('sums non-loopback /proc/net/dev counters', () => {
    const sample = parseProcNetDev(
      [
        'Inter-|   Receive                                                |  Transmit',
        ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
        '    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0',
        '  eth0: 5000 20 0 0 0 0 0 0 8000 30 0 0 0 0 0 0',
        '  eth1: 1500 5 0 0 0 0 0 0 2500 8 0 0 0 0 0 0',
        '  veth0: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0',
      ].join('\n'),
    );
    assert.deepEqual(sample, {
      inboundBytes: 6500n,
      outboundBytes: 10500n,
    });
  });

  it('computes network bytes/sec between samples', () => {
    const rates = networkRatesPerSecond(
      {
        sample: { inboundBytes: 1000n, outboundBytes: 2000n },
        atMs: 1_000,
      },
      { inboundBytes: 3000n, outboundBytes: 6000n },
      3_000,
    );
    assert.deepEqual(rates, {
      inboundBytesPerSecond: 1000n,
      outboundBytesPerSecond: 2000n,
    });
  });
});

describe('HostLoadSampler', () => {
  it('returns cpu/memory on first sample (cpu percent starts at 0)', () => {
    const sampler = new HostLoadSampler('/proc');
    const load = sampler.sample();
    assert.equal(typeof load.cpuPercent, 'number');
    assert.equal(typeof load.memoryPercent, 'number');
    assert.ok((load.cpuPercent ?? 0) >= 0);
    assert.ok((load.memoryPercent ?? 0) >= 0);
    assert.ok((load.cpuPercent ?? 0) <= 100);
    assert.ok((load.memoryPercent ?? 0) <= 100);
  });
});
