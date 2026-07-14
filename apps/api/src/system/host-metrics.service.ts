import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SystemHostStats } from '@overvpn/shared/schemas';
import * as os from 'node:os';
import type { AppEnvironment } from '../config/environment';
import {
  cpuUsagePercent,
  networkRatesPerSecond,
  readCpuSample,
  readMemorySample,
  readNetworkSample,
  type CpuSample,
  type NetworkSample,
} from './host-metrics';

const SAMPLE_INTERVAL_MS = 2_000;

@Injectable()
export class HostMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HostMetricsService.name);
  private readonly procRoot: string;
  private timer: NodeJS.Timeout | null = null;
  private previousCpu: CpuSample | null = null;
  private previousNetwork: { sample: NetworkSample; atMs: number } | null =
    null;
  private snapshot: SystemHostStats;

  constructor(config: ConfigService<AppEnvironment, true>) {
    this.procRoot = config.get('HOST_PROC', { infer: true });
    this.snapshot = this.emptySnapshot();
  }

  onModuleInit(): void {
    this.sample();
    this.timer = setInterval(() => {
      try {
        this.sample();
      } catch (error) {
        this.logger.warn(
          `Host metrics sample failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStats(): SystemHostStats {
    return this.snapshot;
  }

  private sample(): void {
    const now = Date.now();
    const cpu = readCpuSample(this.procRoot);
    const usagePercent = cpuUsagePercent(this.previousCpu, cpu);
    this.previousCpu = cpu;

    const memory = readMemorySample(this.procRoot);
    const usedBytes =
      memory.totalBytes > memory.availableBytes
        ? memory.totalBytes - memory.availableBytes
        : 0n;

    const network = readNetworkSample(this.procRoot);
    let inboundBytes = 0n;
    let outboundBytes = 0n;
    let inboundBytesPerSecond = 0n;
    let outboundBytesPerSecond = 0n;
    if (network) {
      const rates = networkRatesPerSecond(this.previousNetwork, network, now);
      inboundBytes = network.inboundBytes;
      outboundBytes = network.outboundBytes;
      inboundBytesPerSecond = rates.inboundBytesPerSecond;
      outboundBytesPerSecond = rates.outboundBytesPerSecond;
      this.previousNetwork = { sample: network, atMs: now };
    }

    this.snapshot = {
      checkedAt: new Date(now).toISOString(),
      cpu: {
        cores: Math.max(1, os.cpus().length),
        usagePercent,
      },
      memory: {
        totalBytes: memory.totalBytes.toString(),
        usedBytes: usedBytes.toString(),
        availableBytes: memory.availableBytes.toString(),
      },
      network: {
        inboundBytes: inboundBytes.toString(),
        outboundBytes: outboundBytes.toString(),
        inboundBytesPerSecond: inboundBytesPerSecond.toString(),
        outboundBytesPerSecond: outboundBytesPerSecond.toString(),
      },
    };
  }

  private emptySnapshot(): SystemHostStats {
    return {
      checkedAt: new Date().toISOString(),
      cpu: { cores: Math.max(1, os.cpus().length), usagePercent: 0 },
      memory: {
        totalBytes: '0',
        usedBytes: '0',
        availableBytes: '0',
      },
      network: {
        inboundBytes: '0',
        outboundBytes: '0',
        inboundBytesPerSecond: '0',
        outboundBytesPerSecond: '0',
      },
    };
  }
}
