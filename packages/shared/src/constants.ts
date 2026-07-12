export const PRODUCT_NAME = 'OverVPN';
export const API_PREFIX = '/api';
export const API_VERSION = '0.1.0';
export const DEFAULT_API_PORT = 3000;

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const ADMIN_ROLES = ['OWNER', 'ADMIN', 'READONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PLAN_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const INBOUND_PROTOCOLS = ['HYSTERIA2', 'VLESS_REALITY', 'TROJAN', 'SHADOWSOCKS'] as const;
export type InboundProtocol = (typeof INBOUND_PROTOCOLS)[number];

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const CORE_APPLY_STATUSES = [
  'PENDING',
  'APPLYING',
  'SUCCEEDED',
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

export const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const ERROR_MESSAGES = {
  VALIDATION_FAILED: {
    en: 'Request validation failed',
    ru: 'Ошибка проверки запроса',
  },
  AUTH_INVALID_CREDENTIALS: {
    en: 'Invalid username or password',
    ru: 'Неверное имя пользователя или пароль',
  },
  AUTH_TOTP_REQUIRED: {
    en: 'A TOTP code is required',
    ru: 'Требуется одноразовый код TOTP',
  },
  AUTH_TOTP_INVALID: {
    en: 'The TOTP code is invalid',
    ru: 'Неверный одноразовый код TOTP',
  },
  AUTH_TOKEN_INVALID: {
    en: 'Authentication token is invalid or expired',
    ru: 'Токен аутентификации недействителен или истёк',
  },
  AUTH_REFRESH_REUSED: {
    en: 'Refresh token reuse was detected; the token family was revoked',
    ru: 'Обнаружено повторное использование refresh-токена; семейство отозвано',
  },
  AUTH_ACCOUNT_INACTIVE: {
    en: 'Administrator account is inactive',
    ru: 'Учётная запись администратора отключена',
  },
  FORBIDDEN: {
    en: 'You do not have permission to perform this action',
    ru: 'Недостаточно прав для выполнения действия',
  },
  RATE_LIMITED: {
    en: 'Too many requests; try again later',
    ru: 'Слишком много запросов; повторите попытку позже',
  },
  SUBSCRIPTION_NOT_FOUND: {
    en: 'Subscription was not found',
    ru: 'Подписка не найдена',
  },
  SUBSCRIPTION_INACTIVE: {
    en: 'Subscription is not active',
    ru: 'Подписка не активна',
  },
  SUBSCRIPTION_EMPTY: {
    en: 'Subscription has no available servers',
    ru: 'В подписке нет доступных серверов',
  },
  SUBSCRIPTION_UNAVAILABLE: {
    en: 'Subscription service is temporarily unavailable',
    ru: 'Сервис подписок временно недоступен',
  },
  NOT_FOUND: {
    en: 'Resource was not found',
    ru: 'Ресурс не найден',
  },
  CONFLICT: {
    en: 'The request conflicts with the current resource state',
    ru: 'Запрос конфликтует с текущим состоянием ресурса',
  },
  INTERNAL_ERROR: {
    en: 'An internal error occurred',
    ru: 'Произошла внутренняя ошибка',
  },
} as const;
export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const BYTES_PER_KIBIBYTE = 1024n;
export const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * 1024n;
export const BYTES_PER_GIBIBYTE = BYTES_PER_MEBIBYTE * 1024n;
