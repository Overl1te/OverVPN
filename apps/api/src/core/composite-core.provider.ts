import { Injectable } from '@nestjs/common';
import type { CoreEngine } from '@overvpn/shared/constants';
import { CoreEngineRegistry } from './core-engine.registry';
import {
  type AggregatedCoreHealthResult,
  type AggregatedOnlineClientsResult,
  type AggregatedTrafficSnapshotResult,
  CoreProvider,
  type CoreDesiredState,
  type CoreProviderApplyResult,
  type CoreValidationResult,
  type OnlineClient,
  type RenderedCoreConfig,
  type TrafficCounter,
} from './core-provider';

@Injectable()
export class CompositeCoreProvider extends CoreProvider {
  constructor(private readonly registry: CoreEngineRegistry) {
    super();
  }

  renderConfig(_state: CoreDesiredState): RenderedCoreConfig {
    throw new Error(
      'CompositeCoreProvider cannot render configs; use CoreApplyService with CoreEngineRegistry.get(engine)',
    );
  }

  validate(_config: RenderedCoreConfig): Promise<CoreValidationResult> {
    return Promise.reject(
      new Error(
        'CompositeCoreProvider cannot validate configs; use CoreApplyService with CoreEngineRegistry.get(engine)',
      ),
    );
  }

  apply(_config: RenderedCoreConfig): Promise<CoreProviderApplyResult> {
    return Promise.reject(
      new Error(
        'CompositeCoreProvider cannot apply configs; use CoreApplyService with CoreEngineRegistry.get(engine)',
      ),
    );
  }

  async health(): Promise<AggregatedCoreHealthResult> {
    const checkedAt = new Date();
    const engines: AggregatedCoreHealthResult['engines'] = {};
    const results = await Promise.all(
      this.registry.all().map(async (provider) => {
        const result = await provider.health();
        engines[provider.engine] = result;
        return result;
      }),
    );
    const healthy = results.length > 0 && results.every((result) => result.healthy);
    const firstError = results.find((result) => !result.healthy);
    return {
      healthy,
      version: aggregateVersions(results.map((result) => result.version)),
      latencyMs: results.reduce(
        (max, result) => Math.max(max, result.latencyMs),
        0,
      ),
      checkedAt,
      error: firstError?.error ?? null,
      errorRu: firstError?.errorRu ?? null,
      engines,
    };
  }

  async getTrafficSnapshot(): Promise<AggregatedTrafficSnapshotResult> {
    const capturedAt = new Date();
    const engines: AggregatedTrafficSnapshotResult['engines'] = {};
    const counters: TrafficCounter[] = [];
    const warnings: string[] = [];
    let supportedCount = 0;

    await Promise.all(
      this.registry.all().map(async (provider) => {
        const snapshot = await provider.getTrafficSnapshot();
        engines[provider.engine] = snapshot;
        if (snapshot.supported) {
          supportedCount += 1;
          counters.push(...snapshot.counters);
          return;
        }
        warnings.push(
          `${provider.engine}: ${snapshot.error.code}: ${snapshot.error.message}`,
        );
      }),
    );

    const partial = warnings.length > 0;
    if (supportedCount === 0) {
      const firstWarning = warnings[0] ?? 'No core engines returned traffic';
      return {
        supported: false,
        capturedAt,
        error: {
          code: 'QUERY_FAILED',
          message: firstWarning,
          messageRu: firstWarning,
        },
        engines,
        partial: true,
        warnings,
      };
    }

    return {
      supported: true,
      capturedAt,
      counters: counters.sort(compareTrafficCounters),
      engines,
      partial,
      warnings,
    };
  }

  async getOnlineClients(): Promise<AggregatedOnlineClientsResult> {
    const capturedAt = new Date();
    const engines: AggregatedOnlineClientsResult['engines'] = {};
    const clients: OnlineClient[] = [];
    const warnings: string[] = [];
    let partial = false;

    await Promise.all(
      this.registry.all().map(async (provider) => {
        const result = await provider.getOnlineClients();
        engines[provider.engine] = result;
        if (result.partial) {
          partial = true;
        }
        warnings.push(
          ...result.warnings.map(
            (warning) => `${provider.engine}: ${warning}`,
          ),
        );
        clients.push(
          ...result.clients.map((client) => ({
            ...client,
            connectionId: ensureUniqueConnectionId(
              provider.engine,
              client.connectionId,
            ),
          })),
        );
      }),
    );

    return {
      capturedAt,
      clients: clients.sort((left, right) =>
        compareStrings(left.connectionId, right.connectionId),
      ),
      partial: partial || warnings.length > 0,
      warnings,
      engines,
    };
  }
}

function ensureUniqueConnectionId(
  engine: CoreEngine,
  connectionId: string,
): string {
  const prefixes: Record<CoreEngine, string> = {
    SING_BOX: 'sing-box:',
    XRAY: 'xray:',
  };
  const prefix = prefixes[engine];
  if (connectionId.startsWith(prefix) || connectionId.startsWith(`${engine}:`)) {
    return connectionId;
  }
  return `${engine}:${connectionId}`;
}

function aggregateVersions(versions: Array<string | null>): string | null {
  const present = versions.filter((version): version is string => Boolean(version));
  if (present.length === 0) {
    return null;
  }
  return present.join('+');
}

function compareTrafficCounters(
  left: TrafficCounter,
  right: TrafficCounter,
): number {
  return (
    compareStrings(left.engine, right.engine) ||
    compareStrings(left.scope, right.scope) ||
    compareStrings(left.key, right.key)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
