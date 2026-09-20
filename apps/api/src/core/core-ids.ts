import type { CoreEngine } from '@overvpn/shared/constants';

const CORE_STATE_IDS = {
  SING_BOX: 'sing-box',
  XRAY: 'xray',
  MTPROXY: 'mtproxy',
  AMNEZIAWG: 'amneziawg',
} as const satisfies Record<CoreEngine, string>;

/** Stable CoreState / config identity for an engine. */
export function coreStateId(engine: CoreEngine): string {
  return CORE_STATE_IDS[engine];
}
