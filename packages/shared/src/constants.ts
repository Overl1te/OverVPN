import catalogJson from './error-catalog.json' with { type: 'json' };

export const PRODUCT_NAME = 'OverVPN';
export const API_PREFIX = '/api';
export const API_VERSION = '0.1.0';
export const DEFAULT_API_PORT = 3000;

/**
 * Build the public subscription URL from SUB_PUBLIC_BASE_URL.
 * - Origin only (`https://host`) → `https://host/api/sub/{token}`
 * - With path (`https://host/sub`) → `https://host/sub/{token}`
 */
export function buildSubscriptionPublicUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    if (!path) {
      return `${url.origin}/api/sub/${token}`;
    }
    return `${url.origin}${path}/${token}`;
  } catch {
    return `${trimmed}/api/sub/${token}`;
  }
}

/** Amnezia VPN subscription (AWG-only native configs). Same token, dedicated path. */
export function buildAmneziawgSubscriptionPublicUrl(baseUrl: string, token: string): string {
  return `${buildSubscriptionPublicUrl(baseUrl, token).replace(/\/+$/, '')}/amneziawg`;
}

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'READONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PLAN_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const CORE_ENGINES = ['SING_BOX', 'XRAY', 'MTPROXY', 'AMNEZIAWG'] as const;
export type CoreEngine = (typeof CORE_ENGINES)[number];

export const INBOUND_PROTOCOLS = [
  'HYSTERIA2',
  'VLESS_REALITY',
  'TROJAN',
  'SHADOWSOCKS',
  'WIREGUARD',
  'VLESS_XHTTP_TLS',
  'VLESS_GRPC_TLS',
  'VLESS_TCP_TLS',
  'TROJAN_TLS',
  'SHADOWSOCKS_XRAY',
  'WIREGUARD_XRAY',
  'MTPROXY',
  'AMNEZIAWG',
] as const;
export type InboundProtocol = (typeof INBOUND_PROTOCOLS)[number];

/** Telegram practical limit on concurrent MTProxy listeners per node. */
export const MAX_MTPROXY_INBOUNDS = 16;

export const PROTOCOL_ENGINE_MAP = {
  HYSTERIA2: 'SING_BOX',
  VLESS_REALITY: 'SING_BOX',
  TROJAN: 'SING_BOX',
  SHADOWSOCKS: 'SING_BOX',
  WIREGUARD: 'SING_BOX',
  VLESS_XHTTP_TLS: 'XRAY',
  VLESS_GRPC_TLS: 'XRAY',
  VLESS_TCP_TLS: 'XRAY',
  TROJAN_TLS: 'XRAY',
  SHADOWSOCKS_XRAY: 'XRAY',
  WIREGUARD_XRAY: 'XRAY',
  MTPROXY: 'MTPROXY',
  AMNEZIAWG: 'AMNEZIAWG',
} as const satisfies Record<InboundProtocol, CoreEngine>;

/**
 * Short client-facing labels for `{protocol}` in endpoint display names.
 * Prefer what distinguishes the entry (transport / mode), not the full enum.
 */
export const PROTOCOL_DISPLAY_LABELS = {
  HYSTERIA2: 'Hysteria2',
  VLESS_REALITY: 'Reality',
  VLESS_XHTTP_TLS: 'XHTTP',
  VLESS_GRPC_TLS: 'gRPC',
  VLESS_TCP_TLS: 'TCP TLS',
  TROJAN: 'Trojan',
  TROJAN_TLS: 'Trojan TLS',
  SHADOWSOCKS: 'Shadowsocks',
  SHADOWSOCKS_XRAY: 'Shadowsocks',
  WIREGUARD: 'WireGuard',
  WIREGUARD_XRAY: 'WireGuard',
  MTPROXY: 'MTProxy',
  AMNEZIAWG: 'AmneziaWG 2.0',
} as const satisfies Record<InboundProtocol, string>;

export function protocolDisplayLabel(protocol: string): string {
  if (Object.hasOwn(PROTOCOL_DISPLAY_LABELS, protocol)) {
    return PROTOCOL_DISPLAY_LABELS[protocol as InboundProtocol];
  }
  return protocol;
}

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const CORE_APPLY_STATUSES = [
  'PENDING',
  'APPLYING',
  'SUCCEEDED',
  'PARTIAL_SUCCEEDED',
  'FAILED',
  'ROLLED_BACK',
] as const;
export type CoreApplyStatus = (typeof CORE_APPLY_STATUSES)[number];

export const CORE_APPLY_TRIGGERS = [
  'MANUAL',
  'MUTATION',
  'SYSTEM_RECONCILIATION',
  'ENFORCEMENT',
] as const;
export type CoreApplyTrigger = (typeof CORE_APPLY_TRIGGERS)[number];

export const RESET_STRATEGIES = ['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'] as const;
export type ResetStrategy = (typeof RESET_STRATEGIES)[number];

export const USER_STATUS_REASONS = ['manual', 'expired', 'quota', 'device', 'ip'] as const;
export type UserStatusReason = (typeof USER_STATUS_REASONS)[number];

export const BULK_USER_ACTIONS = [
  'disable',
  'enable',
  'reset-traffic',
  'extend',
  'set-plan',
  'rotate-sub',
] as const;
export type BulkUserAction = (typeof BULK_USER_ACTIONS)[number];

export const SUBSCRIPTION_FORMATS = ['sing-box', 'links', 'clash'] as const;
export type SubscriptionFormat = (typeof SUBSCRIPTION_FORMATS)[number];

export const AUDIT_OUTCOMES = ['SUCCESS', 'FAILURE'] as const;
export const SORT_ORDERS = ['asc', 'desc'] as const;

export const BACKUP_KINDS = ['DATABASE', 'CORE_CONFIG', 'FULL'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export const BACKUP_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DELETED'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const PROXY_SERVER_STATUSES = ['PENDING', 'ONLINE', 'OFFLINE', 'ERROR', 'DISABLED'] as const;
export type ProxyServerStatus = (typeof PROXY_SERVER_STATUSES)[number];

/** Seeded local ProxyServer id (co-install / migration placeholder). */
export const LOCAL_PROXY_SERVER_ID = '00000000-0000-4000-8000-000000000001' as const;

/** Default agent→panel heartbeat interval (seconds). */
export const DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC = 20;
/** Default install-token TTL (seconds). */
export const DEFAULT_PROXY_INSTALL_TOKEN_TTL_SEC = 3600;
/** Default agent listen port (panel→agent push). */
export const DEFAULT_AGENT_LISTEN_PORT = 7700;

export const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const DOCS_SITE_URL = 'https://overl1te.github.io/OverVPN/' as const;

export type LocalizedText = {
  en: string;
  ru: string;
};

export type ErrorCatalogEntry = {
  id: string;
  title: LocalizedText;
  cause: LocalizedText;
  fix: LocalizedText;
};

export const ERROR_CATALOG = catalogJson as {
  [K in keyof typeof catalogJson]: ErrorCatalogEntry;
};

export type ErrorCode = keyof typeof ERROR_CATALOG;

function catalogMessages(): { [K in ErrorCode]: LocalizedText } {
  const result = {} as { [K in ErrorCode]: LocalizedText };
  for (const code of Object.keys(ERROR_CATALOG) as ErrorCode[]) {
    result[code] = ERROR_CATALOG[code].title;
  }
  return result;
}

export const ERROR_MESSAGES = catalogMessages();

export function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, code);
}

export function errorCatalogEntry(code: string): ErrorCatalogEntry {
  return isErrorCode(code) ? ERROR_CATALOG[code] : ERROR_CATALOG.INTERNAL_ERROR;
}

export function errorDocsPath(id: string): string {
  return `errors/${id.toLowerCase()}.html`;
}

export function errorDocsUrl(id: string): string {
  return `${DOCS_SITE_URL}${errorDocsPath(id)}`;
}

export const BYTES_PER_KIBIBYTE = 1024n;
export const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * 1024n;
export const BYTES_PER_GIBIBYTE = BYTES_PER_MEBIBYTE * 1024n;
