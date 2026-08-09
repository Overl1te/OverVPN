import type { AgentHeartbeatRequest } from '@overvpn/shared/schemas';
import {
  cpuUsagePercent,
  memoryPercent,
  networkRatesPerSecond,
  readCpuSample,
  readMemorySample,
  readNetworkSample,
  type CpuSample,
  type NetworkSample,
} from './host-metrics.js';

export type HostLoadSample = NonNullable<AgentHeartbeatRequest['load']>;

/**
 * Samples host CPU/RAM/NIC between heartbeats.
 * Prefer HOST_PROC bind-mount (`/host/proc`) inside Docker so numbers match the host.
 */
export class HostLoadSampler {
  private previousCpu: CpuSample | null = null;
  private previousNetwork: { sample: NetworkSample; atMs: number } | null = null;

  constructor(private readonly procRoot: string) {}

  sample(nowMs: number = Date.now()): HostLoadSample {
    const cpu = readCpuSample(this.procRoot);
    const cpuPercent = cpuUsagePercent(this.previousCpu, cpu);
    this.previousCpu = cpu;

    const memory = readMemorySample(this.procRoot);
    const memPercent = memoryPercent(memory.totalBytes, memory.availableBytes);

    const load: HostLoadSample = {
      cpuPercent,
      memoryPercent: memPercent,
    };

    const network = readNetworkSample(this.procRoot);
    if (network) {
      const rates = networkRatesPerSecond(this.previousNetwork, network, nowMs);
      load.networkInboundBytesPerSecond = Number(rates.inboundBytesPerSecond);
      load.networkOutboundBytesPerSecond = Number(rates.outboundBytesPerSecond);
      this.previousNetwork = { sample: network, atMs: nowMs };
    }

    return load;
  }
}
