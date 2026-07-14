import {
  cpuUsagePercent,
  networkRatesPerSecond,
  parseProcMeminfo,
  parseProcNetDev,
  parseProcStat,
} from './host-metrics';

describe('host-metrics parsers', () => {
  it('parses /proc/stat cpu jiffies', () => {
    const sample = parseProcStat(
      [
        'cpu  100 20 30 400 10 0 0 0 0 0',
        'cpu0 50 10 15 200 5 0 0 0 0 0',
        '',
      ].join('\n'),
    );
    expect(sample).toEqual({ idle: 410, total: 560 });
  });

  it('computes cpu usage percent between samples', () => {
    const previous = { idle: 400, total: 500 };
    const current = { idle: 450, total: 600 };
    // busy delta 50 / total delta 100 = 50%
    expect(cpuUsagePercent(previous, current)).toBe(50);
    expect(cpuUsagePercent(null, current)).toBe(0);
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
    expect(sample?.totalBytes).toBe(16384000n * 1024n);
    expect(sample?.availableBytes).toBe(8192000n * 1024n);
  });

  it('falls back when MemAvailable is missing', () => {
    const sample = parseProcMeminfo(
      [
        'MemTotal:       1000000 kB',
        'MemFree:         100000 kB',
        'Buffers:          50000 kB',
        'Cached:          200000 kB',
      ].join('\n'),
    );
    expect(sample?.availableBytes).toBe(350000n * 1024n);
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
    expect(sample).toEqual({
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
    expect(rates).toEqual({
      inboundBytesPerSecond: 1000n,
      outboundBytesPerSecond: 2000n,
    });
  });
});
