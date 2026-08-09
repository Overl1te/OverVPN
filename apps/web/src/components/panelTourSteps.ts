export type PanelTourStepId =
  | 'welcome'
  | 'nav-dashboard'
  | 'nav-inbounds'
  | 'nav-plans'
  | 'nav-users'
  | 'nav-online'
  | 'nav-proxy'
  | 'nav-system'
  | 'nav-backups'
  | 'page-inbounds'
  | 'page-plans'
  | 'page-users'
  | 'system-panel-url'
  | 'system-sub-url'
  | 'system-telegram'
  | 'assist-inbound'
  | 'assist-plan'
  | 'assist-user'
  | 'done';

export type PanelTourStepDef = {
  id: PanelTourStepId;
  /** CSS selector for data-tour target */
  target: string;
  route?: string;
  /** Allow clicking the highlighted element (assist CTAs) */
  allowTargetClick?: boolean;
  assist?: 'create-inbound' | 'create-plan' | 'create-user';
};

/** Fixed tour order: explain (A) then assist setup (B). */
export const PANEL_TOUR_STEPS: PanelTourStepDef[] = [
  { id: 'welcome', target: '[data-tour="tour-welcome"]', route: '/dashboard' },
  { id: 'nav-dashboard', target: '[data-tour="nav-dashboard"]' },
  { id: 'nav-inbounds', target: '[data-tour="nav-inbounds"]' },
  { id: 'nav-plans', target: '[data-tour="nav-plans"]' },
  { id: 'nav-users', target: '[data-tour="nav-users"]' },
  { id: 'nav-online', target: '[data-tour="nav-online"]' },
  { id: 'nav-proxy', target: '[data-tour="nav-proxy"]' },
  { id: 'nav-system', target: '[data-tour="nav-system"]' },
  { id: 'nav-backups', target: '[data-tour="nav-backups"]' },
  {
    id: 'page-inbounds',
    target: '[data-tour="page-inbounds"]',
    route: '/inbounds',
  },
  { id: 'page-plans', target: '[data-tour="page-plans"]', route: '/plans' },
  { id: 'page-users', target: '[data-tour="page-users"]', route: '/users' },
  {
    id: 'system-panel-url',
    target: '[data-tour="system-panel-url"]',
    route: '/system',
  },
  {
    id: 'system-sub-url',
    target: '[data-tour="system-sub-url"]',
    route: '/system',
  },
  {
    id: 'system-telegram',
    target: '[data-tour="system-telegram"]',
    route: '/system',
  },
  {
    id: 'assist-inbound',
    target: '[data-tour="create-inbound"]',
    route: '/inbounds',
    allowTargetClick: true,
    assist: 'create-inbound',
  },
  {
    id: 'assist-plan',
    target: '[data-tour="create-plan"]',
    route: '/plans',
    allowTargetClick: true,
    assist: 'create-plan',
  },
  {
    id: 'assist-user',
    target: '[data-tour="create-user"]',
    route: '/users',
    allowTargetClick: true,
    assist: 'create-user',
  },
  { id: 'done', target: '[data-tour="tour-welcome"]', route: '/dashboard' },
];

export function waitForSelector(selector: string, timeoutMs = 4000): Promise<HTMLElement | null> {
  const existing = document.querySelector(selector);
  if (existing instanceof HTMLElement) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) {
        window.clearInterval(timer);
        resolve(el);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(null);
      }
    }, 50);
  });
}
