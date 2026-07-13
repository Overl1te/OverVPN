import { Inject, Injectable } from '@nestjs/common';
import { CORE_ENGINES, type CoreEngine } from '@overvpn/shared/constants';
import type { EngineProvider } from './core-provider';

export const CORE_ENGINE_PROVIDERS = Symbol('CORE_ENGINE_PROVIDERS');

@Injectable()
export class CoreEngineRegistry {
  private readonly providers = new Map<CoreEngine, EngineProvider>();

  constructor(
    @Inject(CORE_ENGINE_PROVIDERS)
    providers: readonly EngineProvider[],
  ) {
    for (const provider of providers) {
      if (this.providers.has(provider.engine)) {
        throw new Error(
          `Multiple core engine providers registered for ${provider.engine}`,
        );
      }
      this.providers.set(provider.engine, provider);
    }
  }

  get<TEngine extends CoreEngine>(engine: TEngine): EngineProvider<TEngine> {
    const provider = this.providers.get(engine);
    if (!provider) {
      throw new Error(`Core engine provider is not registered: ${engine}`);
    }
    return provider as EngineProvider<TEngine>;
  }

  all(): readonly EngineProvider[] {
    return CORE_ENGINES.flatMap((engine) => {
      const provider = this.providers.get(engine);
      return provider ? [provider] : [];
    });
  }
}
