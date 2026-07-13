import type { CoreEngine } from '@overvpn/shared/constants';

/** Stable CoreState / config identity for an engine. */
export function coreStateId(engine: CoreEngine): string {
  return engine === 'SING_BOX' ? 'sing-box' : 'xray';
}
