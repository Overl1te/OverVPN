import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  credentials,
  loadPackageDefinition,
  type ChannelCredentials,
  type Client,
  type ClientUnaryCall,
  type ServiceError,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { AppEnvironment } from '../config/environment';

export interface RawXrayStat {
  name: string;
  value: string;
}

export interface RawXrayOnlineIp {
  ip: string;
  lastSeenUnixSeconds: string;
}

export interface RawXrayUserStat {
  email: string;
  ips: RawXrayOnlineIp[];
  uplinkBytes: string | null;
  downlinkBytes: string | null;
}

export abstract class XrayStatsAdapter {
  abstract queryStats(pattern?: string): Promise<RawXrayStat[]>;
  abstract getUsersStats(): Promise<RawXrayUserStat[]>;
}

interface QueryStatsResponse {
  stat?: Array<{ name?: unknown; value?: unknown }>;
}

interface GetUsersStatsResponse {
  users?: Array<{
    email?: unknown;
    ips?: Array<{ ip?: unknown; last_seen?: unknown }>;
    traffic?: { uplink?: unknown; downlink?: unknown } | null;
  }>;
}

interface StatsClient extends Client {
  QueryStats(
    request: { pattern: string; reset: boolean },
    options: { deadline: Date },
    callback: (
      error: ServiceError | null,
      response?: QueryStatsResponse,
    ) => void,
  ): ClientUnaryCall;
  GetUsersStats(
    request: { include_traffic: boolean; reset: boolean },
    options: { deadline: Date },
    callback: (
      error: ServiceError | null,
      response?: GetUsersStatsResponse,
    ) => void,
  ): ClientUnaryCall;
}

type StatsClientConstructor = new (
  address: string,
  credentials: ChannelCredentials,
) => StatsClient;

@Injectable()
export class GrpcXrayStatsAdapter extends XrayStatsAdapter {
  private readonly address: string;
  private readonly timeoutMs: number;
  private readonly ClientConstructor: StatsClientConstructor;

  constructor(config: ConfigService<AppEnvironment, true>) {
    super();
    this.address = config.get('XRAY_STATS_ADDRESS', { infer: true });
    this.timeoutMs = config.get('XRAY_HEALTH_TIMEOUT_MS', { infer: true });
    const definition = loadSync(join(__dirname, 'proto', 'xray-stats.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = loadPackageDefinition(definition) as Record<string, unknown>;
    this.ClientConstructor = resolveStatsClient(loaded);
  }

  queryStats(pattern = ''): Promise<RawXrayStat[]> {
    const client = this.createClient();
    return new Promise((resolve, reject) => {
      client.QueryStats(
        { pattern, reset: false },
        this.deadline(),
        (error, response) => {
          client.close();
          if (error) {
            reject(error);
            return;
          }
          resolve(
            (response?.stat ?? []).flatMap((entry) => {
              const value = int64String(entry.value);
              return typeof entry.name === 'string' && value !== null
                ? [{ name: entry.name, value }]
                : [];
            }),
          );
        },
      );
    });
  }

  getUsersStats(): Promise<RawXrayUserStat[]> {
    const client = this.createClient();
    return new Promise((resolve, reject) => {
      client.GetUsersStats(
        { include_traffic: true, reset: false },
        this.deadline(),
        (error, response) => {
          client.close();
          if (error) {
            reject(error);
            return;
          }
          resolve(
            (response?.users ?? []).flatMap((user) => {
              if (typeof user.email !== 'string' || !user.email) {
                return [];
              }
              return [
                {
                  email: user.email,
                  ips: (user.ips ?? []).flatMap((entry) => {
                    const lastSeenUnixSeconds = int64String(entry.last_seen);
                    return typeof entry.ip === 'string' &&
                      entry.ip &&
                      lastSeenUnixSeconds !== null
                      ? [{ ip: entry.ip, lastSeenUnixSeconds }]
                      : [];
                  }),
                  uplinkBytes: int64String(user.traffic?.uplink),
                  downlinkBytes: int64String(user.traffic?.downlink),
                },
              ];
            }),
          );
        },
      );
    });
  }

  private createClient(): StatsClient {
    return new this.ClientConstructor(
      this.address,
      credentials.createInsecure(),
    );
  }

  private deadline(): { deadline: Date } {
    return { deadline: new Date(Date.now() + this.timeoutMs) };
  }
}

function resolveStatsClient(
  loaded: Record<string, unknown>,
): StatsClientConstructor {
  const xray = loaded.xray as Record<string, unknown> | undefined;
  const app = xray?.app as Record<string, unknown> | undefined;
  const stats = app?.stats as Record<string, unknown> | undefined;
  const command = stats?.command as Record<string, unknown> | undefined;
  const constructor = command?.StatsService;
  if (typeof constructor !== 'function') {
    throw new Error('Vendored Xray StatsService protobuf could not be loaded');
  }
  return constructor as StatsClientConstructor;
}

function int64String(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return value;
  }
  if (
    (typeof value === 'number' && Number.isSafeInteger(value)) ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return null;
}
