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

export interface RawV2RayStat {
  name: string;
  value: string;
}

export abstract class V2RayStatsAdapter {
  abstract query(): Promise<RawV2RayStat[]>;
}

interface QueryStatsResponse {
  stat?: Array<{ name?: unknown; value?: unknown }>;
}

interface StatsClient extends Client {
  QueryStats(
    request: {
      pattern: string;
      reset: boolean;
      patterns: string[];
      regexp: boolean;
    },
    options: { deadline: Date },
    callback: (
      error: ServiceError | null,
      response?: QueryStatsResponse,
    ) => void,
  ): ClientUnaryCall;
}

type StatsClientConstructor = new (
  address: string,
  credentials: ChannelCredentials,
) => StatsClient;

@Injectable()
export class GrpcV2RayStatsAdapter extends V2RayStatsAdapter {
  private readonly address: string;
  private readonly timeoutMs: number;
  private readonly ClientConstructor: StatsClientConstructor;

  constructor(config: ConfigService<AppEnvironment, true>) {
    super();
    this.address = config.get('SING_BOX_V2RAY_API_ADDRESS', { infer: true });
    this.timeoutMs = config.get('SING_BOX_HEALTH_TIMEOUT_MS', { infer: true });
    const definition = loadSync(join(__dirname, 'proto', 'stats.proto'), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = loadPackageDefinition(definition) as Record<string, unknown>;
    this.ClientConstructor = resolveStatsClient(loaded);
  }

  query(): Promise<RawV2RayStat[]> {
    const client = new this.ClientConstructor(
      this.address,
      credentials.createInsecure(),
    );
    return new Promise((resolve, reject) => {
      client.QueryStats(
        {
          pattern: '',
          reset: false,
          patterns: ['user>>>', 'inbound>>>', 'outbound>>>'],
          regexp: false,
        },
        { deadline: new Date(Date.now() + this.timeoutMs) },
        (error, response) => {
          client.close();
          if (error) {
            reject(error);
            return;
          }
          const stats = (response?.stat ?? []).flatMap((entry) => {
            if (typeof entry.name !== 'string') {
              return [];
            }
            const value =
              typeof entry.value === 'string'
                ? entry.value
                : typeof entry.value === 'number' ||
                    typeof entry.value === 'bigint'
                  ? String(entry.value)
                  : null;
            return value === null ? [] : [{ name: entry.name, value }];
          });
          resolve(stats);
        },
      );
    });
  }
}

function resolveStatsClient(
  loaded: Record<string, unknown>,
): StatsClientConstructor {
  const v2ray = loaded.v2ray as Record<string, unknown> | undefined;
  const core = v2ray?.core as Record<string, unknown> | undefined;
  const app = core?.app as Record<string, unknown> | undefined;
  const stats = app?.stats as Record<string, unknown> | undefined;
  const command = stats?.command as Record<string, unknown> | undefined;
  const constructor = command?.StatsService;
  if (typeof constructor !== 'function') {
    throw new Error('Vendored V2Ray StatsService protobuf could not be loaded');
  }
  return constructor as StatsClientConstructor;
}
