import { z } from 'zod';
import {
  ADMIN_ROLES,
  ASSIGNMENT_STATUSES,
  AUDIT_OUTCOMES,
  BACKUP_KINDS,
  BACKUP_STATUSES,
  BULK_USER_ACTIONS,
  CORE_APPLY_STATUSES,
  CORE_APPLY_TRIGGERS,
  CORE_ENGINES,
  DEFAULT_PAGE_SIZE,
  INBOUND_PROTOCOLS,
  MAX_PAGE_SIZE,
  MAX_SIGNED_BIGINT,
  PLAN_STATUSES,
  RESET_STRATEGIES,
  SORT_ORDERS,
  SUBSCRIPTION_FORMATS,
  SUPPORTED_LOCALES,
  USER_STATUS_REASONS,
  USER_STATUSES,
} from './constants.js';

export const localeSchema = z.enum(SUPPORTED_LOCALES);
export const adminRoleSchema = z.enum(ADMIN_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);
export const planStatusSchema = z.enum(PLAN_STATUSES);
export const inboundProtocolSchema = z.enum(INBOUND_PROTOCOLS);
export const resetStrategySchema = z.enum(RESET_STRATEGIES);
export const userStatusReasonSchema = z.enum(USER_STATUS_REASONS);
export const backupKindSchema = z.enum(BACKUP_KINDS);
export const backupStatusSchema = z.enum(BACKUP_STATUSES);

export const idSchema = z.uuid();
export const subscriptionTokenSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,
    'Expected a canonical 32-byte base64url subscription token',
  );
export const byteCountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, 'Expected unsigned decimal bytes')
  .refine((value) => {
    try {
      return BigInt(value) <= MAX_SIGNED_BIGINT;
    } catch {
      return false;
    }
  }, 'Byte count exceeds signed 64-bit storage');
export const positiveByteCountSchema = byteCountSchema.refine(
  (value) => value !== '0',
  'Expected a positive byte count',
);
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/)
  .transform((value) => value.toLowerCase());
export const identitySchema = z.string().trim().min(1).max(128);
export const tagSchema = z.string().trim().min(1).max(64);

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();

export const adminSummarySchema = z
  .object({
    id: idSchema,
    username: z.string(),
    role: adminRoleSchema,
    locale: localeSchema,
    active: z.boolean(),
    totpEnabled: z.boolean(),
    lastLoginAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type AdminSummary = z.infer<typeof adminSummarySchema>;

export const loginRequestSchema = z
  .object({
    username: usernameSchema,
    password: z.string().min(1).max(256),
    totpCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    returnRefreshToken: z.boolean().optional().default(false),
  })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.preprocess(
  (value) => value ?? {},
  z
    .object({
      refreshToken: z.string().min(32).max(512).optional(),
    })
    .strict(),
);
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = refreshRequestSchema;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export const authenticatedSessionSchema = z
  .object({
    status: z.literal('AUTHENTICATED'),
    accessToken: z.string(),
    accessTokenExpiresInSeconds: z.number().int().positive(),
    refreshToken: z.string().optional(),
    admin: adminSummarySchema,
  })
  .strict();
export type AuthenticatedSession = z.infer<typeof authenticatedSessionSchema>;

export const loginResponseSchema = z.discriminatedUnion('status', [
  authenticatedSessionSchema,
  z
    .object({
      status: z.literal('TOTP_REQUIRED'),
      code: z.literal('AUTH_TOTP_REQUIRED'),
      message: z.string(),
      messageRu: z.string(),
    })
    .strict(),
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const currentPasswordSchema = z.string().min(1).max(256);
export const totpCodeSchema = z.string().regex(/^\d{6}$/);

export const totpEnableRequestSchema = z
  .object({
    currentPassword: currentPasswordSchema,
    currentTotpCode: totpCodeSchema.optional(),
  })
  .strict();
export type TotpEnableRequest = z.infer<typeof totpEnableRequestSchema>;

export const totpConfirmRequestSchema = z
  .object({
    totpCode: totpCodeSchema,
  })
  .strict();
export type TotpConfirmRequest = z.infer<typeof totpConfirmRequestSchema>;

export const totpDisableRequestSchema = z
  .object({
    currentPassword: currentPasswordSchema,
    totpCode: totpCodeSchema,
  })
  .strict();
export type TotpDisableRequest = z.infer<typeof totpDisableRequestSchema>;

export const totpEnableResponseSchema = z
  .object({
    secret: z.string().min(16),
    provisioningUri: z.string().url(),
  })
  .strict();
export type TotpEnableResponse = z.infer<typeof totpEnableResponseSchema>;

export const userSchema = z
  .object({
    id: idSchema,
    identity: z.string(),
    username: z.string(),
    status: userStatusSchema,
    statusReason: userStatusReasonSchema.nullable(),
    note: z.string().nullable(),
    tags: z.array(z.string()),
    expireAt: isoDateTimeSchema.nullable(),
    dataLimitBytes: byteCountSchema.nullable(),
    usedUploadBytes: byteCountSchema,
    usedDownloadBytes: byteCountSchema,
    accountingEpoch: z.number().int().nonnegative(),
    trafficResetAt: isoDateTimeSchema.nullable(),
    resetStrategy: resetStrategySchema,
    nextResetAt: isoDateTimeSchema.nullable(),
    deviceLimit: z.number().int().positive().nullable(),
    ipLimit: z.number().int().positive().nullable(),
    identityLimitHoldUntil: isoDateTimeSchema.nullable(),
    speedLimitBps: byteCountSchema.nullable(),
    subToken: z.string(),
    planId: idSchema.nullable(),
    needsApply: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    deletedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type UserResult = z.infer<typeof userSchema>;

const userLimitsSchema = {
  expireAt: isoDateTimeSchema.nullable().optional(),
  dataLimitBytes: byteCountSchema.nullable().optional(),
  resetStrategy: resetStrategySchema.optional(),
  nextResetAt: isoDateTimeSchema.nullable().optional(),
  deviceLimit: z.number().int().positive().nullable().optional(),
  ipLimit: z.number().int().positive().nullable().optional(),
  speedLimitBps: byteCountSchema.nullable().optional(),
};

export const createUserSchema = z
  .object({
    identity: identitySchema.optional(),
    username: usernameSchema,
    status: userStatusSchema.optional().default('ACTIVE'),
    statusReason: userStatusReasonSchema.nullable().optional(),
    note: z.string().trim().max(4_000).nullable().optional(),
    tags: z.array(tagSchema).max(50).optional().default([]),
    planId: idSchema.nullable().optional(),
    ...userLimitsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateUserStatusReason(value.status, value.statusReason, context);
  });
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    identity: identitySchema.optional(),
    username: usernameSchema.optional(),
    status: userStatusSchema.optional(),
    statusReason: userStatusReasonSchema.nullable().optional(),
    note: z.string().trim().max(4_000).nullable().optional(),
    tags: z.array(tagSchema).max(50).optional(),
    planId: idSchema.nullable().optional(),
    ...userLimitsSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
  .superRefine((value, context) => {
    if (value.status) {
      validateUserStatusReason(value.status, value.statusReason, context);
    }
  });
export type UpdateUser = z.infer<typeof updateUserSchema>;

export const userListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().max(128).optional(),
    status: userStatusSchema.optional(),
    tag: tagSchema.optional(),
    planId: idSchema.optional(),
    sortBy: z
      .enum(['username', 'identity', 'status', 'expireAt', 'createdAt', 'updatedAt'])
      .default('createdAt'),
    sortOrder: z.enum(SORT_ORDERS).default('desc'),
  })
  .strict();
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const userListResponseSchema = z
  .object({
    items: z.array(userSchema),
    pagination: paginationMetaSchema,
  })
  .strict();

const bulkIdsSchema = z.array(idSchema).min(1).max(500);
export const bulkUserActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal(BULK_USER_ACTIONS[0]), userIds: bulkIdsSchema }).strict(),
  z.object({ action: z.literal(BULK_USER_ACTIONS[1]), userIds: bulkIdsSchema }).strict(),
  z.object({ action: z.literal(BULK_USER_ACTIONS[2]), userIds: bulkIdsSchema }).strict(),
  z
    .object({
      action: z.literal(BULK_USER_ACTIONS[3]),
      userIds: bulkIdsSchema,
      days: z.number().int().min(1).max(3_650),
    })
    .strict(),
  z
    .object({
      action: z.literal(BULK_USER_ACTIONS[4]),
      userIds: bulkIdsSchema,
      planId: idSchema.nullable(),
    })
    .strict(),
  z.object({ action: z.literal(BULK_USER_ACTIONS[5]), userIds: bulkIdsSchema }).strict(),
]);
export type BulkUserActionRequest = z.infer<typeof bulkUserActionSchema>;

export const bulkUserActionResponseSchema = z
  .object({
    action: z.enum(BULK_USER_ACTIONS),
    affected: z.number().int().nonnegative(),
    users: z.array(userSchema),
  })
  .strict();

const utcDateSchema = z.iso.date();

export const usageDateRangeQuerySchema = z
  .object({
    from: utcDateSchema.optional(),
    to: utcDateSchema.optional(),
  })
  .strict()
  .transform((value, context) => {
    const today = new Date();
    const defaultTo = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const to = value.to ? new Date(`${value.to}T00:00:00.000Z`) : defaultTo;
    const from = value.from
      ? new Date(`${value.from}T00:00:00.000Z`)
      : new Date(to.getTime() - 29 * 24 * 60 * 60 * 1_000);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    if (days < 0 || days > 365) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Usage range must include between 1 and 366 UTC days',
      });
      return z.NEVER;
    }
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    };
  });
export type UsageDateRangeQuery = z.infer<typeof usageDateRangeQuerySchema>;

export const usageDailyPointSchema = z
  .object({
    day: utcDateSchema,
    uploadBytes: byteCountSchema,
    downloadBytes: byteCountSchema,
    totalBytes: byteCountSchema,
  })
  .strict();

export const userUsageSummarySchema = z
  .object({
    from: utcDateSchema,
    to: utcDateSchema,
    usedUploadBytes: byteCountSchema,
    usedDownloadBytes: byteCountSchema,
    usedTotalBytes: byteCountSchema,
    dataLimitBytes: byteCountSchema.nullable(),
    remainingBytes: byteCountSchema.nullable(),
    dailyUploadBytes: byteCountSchema,
    dailyDownloadBytes: byteCountSchema,
    periodUploadBytes: byteCountSchema,
    periodDownloadBytes: byteCountSchema,
    periodTotalBytes: byteCountSchema,
    series: z.array(usageDailyPointSchema).max(366),
  })
  .strict();
export type UserUsageSummary = z.infer<typeof userUsageSummarySchema>;

export const onlineSessionSchema = z
  .object({
    id: idSchema,
    sessionKey: z.string(),
    inboundId: idSchema,
    inboundTag: z.string(),
    ipAddress: z.string().nullable(),
    deviceId: z.string().nullable(),
    uploadBytes: byteCountSchema.nullable(),
    downloadBytes: byteCountSchema.nullable(),
    connectedAt: isoDateTimeSchema,
    lastSeenAt: isoDateTimeSchema,
    disconnectedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export type OnlineSession = z.infer<typeof onlineSessionSchema>;

export const userConnectionIdentitySchema = z
  .object({
    key: z.string().min(1).max(255),
    kind: z.enum(['ip', 'device']),
    ipAddress: z.string().nullable(),
    deviceId: z.string().nullable(),
    firstSeenAt: isoDateTimeSchema,
    lastSeenAt: isoDateTimeSchema,
    sessionCount: z.number().int().nonnegative(),
    online: z.boolean(),
  })
  .strict();
export type UserConnectionIdentity = z.infer<typeof userConnectionIdentitySchema>;

export const userConnectionIdentitiesSchema = z
  .object({
    lookbackMs: z.number().int().positive(),
    identityLimitHoldUntil: isoDateTimeSchema.nullable(),
    deviceLimit: z.number().int().positive().nullable(),
    ipLimit: z.number().int().positive().nullable(),
    deviceCount: z.number().int().nonnegative(),
    ipCount: z.number().int().nonnegative(),
    ips: z.array(userConnectionIdentitySchema),
    devices: z.array(userConnectionIdentitySchema),
  })
  .strict();
export type UserConnectionIdentities = z.infer<typeof userConnectionIdentitiesSchema>;

export const onlineSessionListQuerySchema = paginationQuerySchema
  .extend({
    userId: idSchema.optional(),
    inboundId: idSchema.optional(),
    username: z.string().trim().min(1).max(64).optional(),
    inboundTag: z.string().trim().min(1).max(64).optional(),
    ip: z.string().trim().min(1).max(64).optional(),
    state: z.enum(['active', 'history', 'all']).default('active'),
  })
  .strict();
export type OnlineSessionListQuery = z.infer<typeof onlineSessionListQuerySchema>;

export const adminOnlineSessionSchema = onlineSessionSchema
  .extend({
    userId: idSchema,
    username: z.string(),
  })
  .strict();

export const onlineSessionListResponseSchema = z
  .object({
    items: z.array(adminOnlineSessionSchema),
    pagination: paginationMetaSchema,
  })
  .strict();
export type OnlineSessionListResponse = z.infer<typeof onlineSessionListResponseSchema>;

export const globalUsageSchema = z
  .object({
    from: utcDateSchema,
    to: utcDateSchema,
    uploadBytes: byteCountSchema,
    downloadBytes: byteCountSchema,
    totalBytes: byteCountSchema,
    series: z.array(usageDailyPointSchema).max(366),
  })
  .strict();
export type GlobalUsage = z.infer<typeof globalUsageSchema>;

export const workerHealthSchema = z
  .object({
    name: z.enum([
      'traffic-collector',
      'daily-aggregator',
      'online-collector',
      'online-sweeper',
      'limit-enforcer',
      'update-checker',
    ]),
    state: z.enum([
      'NOT_RUN',
      'RUNNING',
      'HEALTHY',
      'DEGRADED',
      'FAILED',
      'DISABLED',
      'STALE',
      'UNAVAILABLE',
    ]),
    lastStartedAt: isoDateTimeSchema.nullable(),
    lastFinishedAt: isoDateTimeSchema.nullable(),
    lastSuccessAt: isoDateTimeSchema.nullable(),
    lastFailureAt: isoDateTimeSchema.nullable(),
    error: z.string().nullable(),
    durationMs: z.number().nonnegative().nullable(),
    details: z.record(z.string(), z.unknown()),
    staleAfterMs: z.number().int().positive(),
  })
  .strict();

export const coreHealthEngineSchema = z
  .object({
    healthy: z.boolean(),
    version: z.string().nullable(),
    latencyMs: z.number().nonnegative(),
    checkedAt: isoDateTimeSchema,
    error: z.string().nullable(),
    errorRu: z.string().nullable(),
  })
  .strict();

export const coreHealthSchema = coreHealthEngineSchema
  .extend({
    engines: z.partialRecord(z.enum(CORE_ENGINES), coreHealthEngineSchema).optional(),
  })
  .strict();

const throughputSchema = z.discriminatedUnion('available', [
  z
    .object({
      available: z.literal(true),
      capturedAt: isoDateTimeSchema,
      uploadBytesPerSecond: byteCountSchema,
      downloadBytesPerSecond: byteCountSchema,
      totalBytesPerSecond: byteCountSchema,
    })
    .strict(),
  z
    .object({
      available: z.literal(false),
      reason: z.string(),
      reasonRu: z.string(),
      lastSuccessfulAt: isoDateTimeSchema.nullable(),
    })
    .strict(),
]);

export const systemDashboardSchema = z
  .object({
    generatedAt: isoDateTimeSchema,
    users: z
      .object({
        total: z.number().int().nonnegative(),
        byStatus: z
          .object({
            ACTIVE: z.number().int().nonnegative(),
            DISABLED: z.number().int().nonnegative(),
            EXPIRED: z.number().int().nonnegative(),
            LIMITED: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    online: z.object({ active: z.number().int().nonnegative() }).strict(),
    traffic: z
      .object({
        current: z
          .object({
            uploadBytes: byteCountSchema,
            downloadBytes: byteCountSchema,
            totalBytes: byteCountSchema,
          })
          .strict(),
        period: globalUsageSchema,
        throughput: throughputSchema,
      })
      .strict(),
    core: coreHealthSchema,
    workers: z.array(workerHealthSchema),
  })
  .strict();
export type SystemDashboard = z.infer<typeof systemDashboardSchema>;

export const systemHealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checkedAt: isoDateTimeSchema,
    core: coreHealthSchema,
    workers: z.array(workerHealthSchema),
  })
  .strict();
export type SystemHealth = z.infer<typeof systemHealthSchema>;

export const systemEngineStatusSchema = z
  .object({
    engine: z.enum(CORE_ENGINES),
    enabled: z.boolean(),
    running: z.boolean(),
    healthy: z.boolean().nullable(),
    version: z.string().nullable(),
    protocols: z.array(inboundProtocolSchema),
    publishedPorts: z.array(
      z
        .object({
          protocol: inboundProtocolSchema,
          port: z.number().int().min(1).max(65_535),
          transport: z.enum(['tcp', 'udp']),
        })
        .strict(),
    ),
    enableCommand: z.string().min(1),
  })
  .strict();
export type SystemEngineStatus = z.infer<typeof systemEngineStatusSchema>;

export const systemEnginesSchema = z
  .object({
    checkedAt: isoDateTimeSchema,
    engines: z.array(systemEngineStatusSchema),
  })
  .strict();
export type SystemEngines = z.infer<typeof systemEnginesSchema>;

/** Host device stats for the admin overview (CPU / RAM / NIC), Marzban-style. */
export const systemHostStatsSchema = z
  .object({
    checkedAt: isoDateTimeSchema,
    cpu: z
      .object({
        cores: z.number().int().positive(),
        usagePercent: z.number().min(0).max(100),
      })
      .strict(),
    memory: z
      .object({
        totalBytes: byteCountSchema,
        usedBytes: byteCountSchema,
        availableBytes: byteCountSchema,
      })
      .strict(),
    network: z
      .object({
        inboundBytes: byteCountSchema,
        outboundBytes: byteCountSchema,
        inboundBytesPerSecond: byteCountSchema,
        outboundBytesPerSecond: byteCountSchema,
      })
      .strict(),
  })
  .strict();
export type SystemHostStats = z.infer<typeof systemHostStatsSchema>;

/** Panel/API update check against the repo tip (no GitHub Releases required). */
export const systemUpdateStatusSchema = z
  .object({
    checkedAt: isoDateTimeSchema.nullable(),
    updateAvailable: z.boolean(),
    currentSha: z.string().nullable(),
    latestSha: z.string().nullable(),
    latestShortSha: z.string().nullable(),
    latestHtmlUrl: z.string().nullable(),
    channel: z.string(),
    checkEnabled: z.boolean(),
    currentKnown: z.boolean(),
    error: z.string().nullable(),
    errorRu: z.string().nullable(),
    applyHint: z.string(),
    applyHintRu: z.string(),
  })
  .strict();
export type SystemUpdateStatus = z.infer<typeof systemUpdateStatusSchema>;

const subscriptionTitleTemplateSchema = z.string().trim().max(200);
const subscriptionAnnounceSchema = z.string().trim().max(500);
const optionalHttpUrlSchema = z.union([z.url().max(2048), z.literal(''), z.null()]);
const optionalDeeplinkSchema = z.union([z.string().trim().max(2048), z.null()]);
export const subscriptionSubInfoColorSchema = z.enum(['red', 'blue', 'green']);
export type SubscriptionSubInfoColor = z.infer<typeof subscriptionSubInfoColorSchema>;

export const planSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    status: planStatusSchema,
    defaultDataLimitBytes: byteCountSchema.nullable(),
    defaultExpiryDays: z.number().int().positive().nullable(),
    defaultDeviceLimit: z.number().int().positive().nullable(),
    defaultIpLimit: z.number().int().positive().nullable(),
    defaultSpeedLimitBps: byteCountSchema.nullable(),
    defaultResetStrategy: resetStrategySchema,
    subscriptionTitleTemplate: z.string().nullable(),
    subscriptionAnnounce: z.string().nullable(),
    subscriptionSupportUrl: z.string().nullable(),
    subscriptionWebPageUrl: z.string().nullable(),
    happProviderId: z.string().nullable(),
    subscriptionSubInfoText: z.string().nullable(),
    subscriptionSubInfoColor: subscriptionSubInfoColorSchema.nullable(),
    subscriptionSubInfoButtonText: z.string().nullable(),
    subscriptionSubInfoButtonLink: z.string().nullable(),
    subscriptionSubExpireEnabled: z.boolean(),
    subscriptionSubExpireButtonLink: z.string().nullable(),
    subscriptionFallbackUrlTemplate: z.string().nullable(),
    subscriptionColorProfile: z.string().nullable(),
    subscriptionShowTrafficLimits: z.boolean(),
    inboundIds: z.array(idSchema),
    userCount: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    archivedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type PlanResult = z.infer<typeof planSchema>;

const planFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(4_000).nullable().optional(),
  defaultDataLimitBytes: byteCountSchema.nullable().optional(),
  defaultExpiryDays: z.number().int().min(1).max(3_650).nullable().optional(),
  defaultDeviceLimit: z.number().int().min(1).max(10_000).nullable().optional(),
  defaultIpLimit: z.number().int().min(1).max(10_000).nullable().optional(),
  defaultSpeedLimitBps: byteCountSchema.nullable().optional(),
  defaultResetStrategy: resetStrategySchema.optional(),
  subscriptionTitleTemplate: subscriptionTitleTemplateSchema.nullable().optional(),
  subscriptionAnnounce: subscriptionAnnounceSchema.nullable().optional(),
  subscriptionSupportUrl: optionalHttpUrlSchema.optional(),
  subscriptionWebPageUrl: optionalHttpUrlSchema.optional(),
  happProviderId: z.string().trim().max(128).nullable().optional(),
  subscriptionSubInfoText: z.string().trim().max(500).nullable().optional(),
  subscriptionSubInfoColor: subscriptionSubInfoColorSchema.nullable().optional(),
  subscriptionSubInfoButtonText: z.string().trim().max(25).nullable().optional(),
  subscriptionSubInfoButtonLink: optionalDeeplinkSchema.optional(),
  subscriptionSubExpireEnabled: z.boolean().optional(),
  subscriptionSubExpireButtonLink: optionalDeeplinkSchema.optional(),
  subscriptionFallbackUrlTemplate: z.string().trim().max(2048).nullable().optional(),
  subscriptionColorProfile: z.string().trim().max(65_536).nullable().optional(),
  subscriptionShowTrafficLimits: z.boolean().optional(),
  inboundIds: z.array(idSchema).max(128).optional(),
};

function normalizePlanBrandingFields<T extends Record<string, unknown>>(value: T): T {
  const stringKeys = [
    'subscriptionTitleTemplate',
    'subscriptionAnnounce',
    'subscriptionSupportUrl',
    'subscriptionWebPageUrl',
    'happProviderId',
    'subscriptionSubInfoText',
    'subscriptionSubInfoButtonText',
    'subscriptionSubInfoButtonLink',
    'subscriptionSubExpireButtonLink',
    'subscriptionFallbackUrlTemplate',
    'subscriptionColorProfile',
  ] as const;
  const next: Record<string, unknown> = { ...value };
  for (const key of stringKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const raw = value[key];
      next[key] = typeof raw === 'string' || raw === null ? emptyToNull(raw) : raw;
    }
  }
  return next as T;
}

export const createPlanSchema = z
  .object(planFields)
  .strict()
  .transform((value) =>
    normalizePlanBrandingFields({
      ...value,
      inboundIds: [...new Set(value.inboundIds ?? [])],
    }),
  );
export type CreatePlan = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z
  .object({
    ...planFields,
    name: planFields.name.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
  .transform((value) =>
    normalizePlanBrandingFields({
      ...value,
      inboundIds: value.inboundIds ? [...new Set(value.inboundIds)] : undefined,
    }),
  );
export type UpdatePlan = z.infer<typeof updatePlanSchema>;

function emptyToNull(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  return value;
}

export const planListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().max(100).optional(),
    status: planStatusSchema.optional(),
    sortOrder: z.enum(SORT_ORDERS).default('asc'),
  })
  .strict();
export type PlanListQuery = z.infer<typeof planListQuerySchema>;

export const planListResponseSchema = z
  .object({
    items: z.array(planSchema),
    pagination: paginationMetaSchema,
  })
  .strict();

const singBoxHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      !/[\s/?#@]/.test(value) &&
      !value.includes('://') &&
      !value.includes('\0') &&
      isSingBoxHost(value),
    'Expected a host name or IP address without a scheme or port',
  );
const singBoxPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes('\0'), 'Path cannot contain a NUL byte');
const singBoxDurationSchema = z
  .string()
  .trim()
  .max(64)
  .regex(
    /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/,
    'Expected a Go duration such as 30s or 1m30s',
  );
const singBoxPortSchema = z.number().int().min(1).max(65_535);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean());
const singBoxTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
const secretInputSchema = z.string().min(8).max(16_384);
const credentialPasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine(
    (value) =>
      !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).length <= 128,
    'Password must be at most 128 UTF-8 bytes without control characters',
  );
const tlsVersionSchema = z.enum(['1.0', '1.1', '1.2', '1.3']);
const tlsCurveSchema = z.enum(['P256', 'P384', 'P521', 'X25519', 'X25519MLKEM768']);
const tlsCommonInputFields = {
  sni: singBoxHostSchema,
  alpn: z.array(z.string().trim().min(1).max(64)).max(16).default(['h3']),
  minVersion: tlsVersionSchema.optional().default('1.2'),
  maxVersion: tlsVersionSchema.optional(),
  cipherSuites: z.array(z.string().trim().min(1).max(128)).max(32).default([]),
  curvePreferences: z.array(tlsCurveSchema).max(16).default([]),
  kernelTx: z.boolean().default(false),
  kernelRx: z.boolean().default(false),
  clientInsecure: z.boolean().default(false),
};

export const hysteria2TlsFilesInputSchema = z
  .object({
    mode: z.literal('FILES'),
    ...tlsCommonInputFields,
    certificatePath: singBoxPathSchema.optional(),
    keyPath: singBoxPathSchema.optional(),
    certificatePem: z.string().min(1).max(1_000_000).optional(),
    privateKeyPem: z.string().min(1).max(1_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasPaths = value.certificatePath !== undefined || value.keyPath !== undefined;
    const hasInline = value.certificatePem !== undefined || value.privateKeyPem !== undefined;
    if (hasPaths && (!value.certificatePath || !value.keyPath)) {
      context.addIssue({
        code: 'custom',
        path: ['certificatePath'],
        message: 'certificatePath and keyPath must be supplied together',
      });
    }
    if (hasInline && (!value.certificatePem || !value.privateKeyPem)) {
      context.addIssue({
        code: 'custom',
        path: ['certificatePem'],
        message: 'certificatePem and privateKeyPem must be supplied together',
      });
    }
    if (hasPaths === hasInline) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'FILES TLS requires exactly one certificate source: paths or inline PEM',
      });
    }
  });

const acmeExternalAccountInputSchema = z
  .object({
    keyId: z.string().trim().min(1).max(512),
    macKey: secretInputSchema,
  })
  .strict();
const acmeAliDnsInputSchema = z
  .object({
    provider: z.literal('alidns'),
    accessKeyId: z.string().trim().min(1).max(512),
    accessKeySecret: secretInputSchema,
    regionId: z.string().trim().min(1).max(128).optional(),
    securityToken: secretInputSchema.optional(),
  })
  .strict();
const acmeCloudflareInputSchema = z
  .object({
    provider: z.literal('cloudflare'),
    apiToken: secretInputSchema.optional(),
    zoneToken: secretInputSchema.optional(),
  })
  .strict()
  .refine((value) => value.apiToken || value.zoneToken, {
    message: 'Cloudflare DNS-01 requires apiToken or zoneToken',
  });
const acmeDnsInputSchema = z
  .object({
    provider: z.literal('acme-dns'),
    username: z.string().trim().min(1).max(512),
    password: secretInputSchema,
    subdomain: singBoxHostSchema,
    serverUrl: z.url().refine((value) => isHttpUrlWithoutCredentials(value, true), {
      message: 'ACME-DNS serverUrl must use HTTPS without embedded credentials',
    }),
  })
  .strict();
export const hysteria2AcmeDns01InputSchema = z.discriminatedUnion('provider', [
  acmeAliDnsInputSchema,
  acmeCloudflareInputSchema,
  acmeDnsInputSchema,
]);

const acmeProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      value === 'letsencrypt' || value === 'zerossl' || isHttpUrlWithoutCredentials(value, true),
    'ACME provider must be letsencrypt, zerossl, or an HTTPS directory URL',
  );

const optionalEmailSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.email().max(320).optional(),
);

export const hysteria2TlsAcmeInputSchema = z
  .object({
    mode: z.literal('ACME'),
    ...tlsCommonInputFields,
    domains: z.array(singBoxHostSchema).min(1).max(100),
    dataDirectory: singBoxPathSchema,
    defaultServerName: singBoxHostSchema.optional(),
    email: optionalEmailSchema,
    provider: acmeProviderSchema.default('letsencrypt'),
    disableHttpChallenge: z.boolean().default(false),
    disableTlsAlpnChallenge: z.boolean().default(false),
    alternativeHttpPort: singBoxPortSchema.optional(),
    alternativeTlsPort: singBoxPortSchema.optional(),
    externalAccount: acmeExternalAccountInputSchema.optional(),
    dns01Challenge: hysteria2AcmeDns01InputSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.disableHttpChallenge && value.disableTlsAlpnChallenge && !value.dns01Challenge) {
      context.addIssue({
        code: 'custom',
        path: ['dns01Challenge'],
        message: 'At least one ACME challenge must remain enabled',
      });
    }
    if (value.provider === 'zerossl' && !value.email && !value.externalAccount) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'ZeroSSL requires email or externalAccount',
      });
    }
  });

export const hysteria2TlsInputSchema = z.discriminatedUnion('mode', [
  hysteria2TlsFilesInputSchema,
  hysteria2TlsAcmeInputSchema,
]);

const optionalCredentialPasswordSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  credentialPasswordSchema.optional(),
);

export const hysteria2ObfsInputSchema = z
  .object({
    type: z.literal('SALAMANDER'),
    password: optionalCredentialPasswordSchema,
  })
  .strict();

export const hysteria2MasqueradeInputSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('FILE'),
      directory: singBoxPathSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PROXY'),
      url: z
        .url()
        .refine(
          (value) => isHttpUrlWithoutCredentials(value),
          'Masquerade proxy URL must use HTTP or HTTPS without embedded credentials',
        ),
      rewriteHost: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      type: z.literal('STRING'),
      statusCode: z.number().int().min(100).max(599).default(404),
      headers: z
        .record(
          z.string().trim().min(1).max(256),
          z.union([z.string().max(8_192), z.array(z.string().max(8_192)).max(32)]),
        )
        .default({}),
      content: z.string().max(1_000_000),
    })
    .strict(),
]);

export const hysteria2InboundSettingsSchema = z
  .object({
    listenHost: singBoxHostSchema.default('0.0.0.0'),
    listenPort: singBoxPortSchema,
    publicHost: singBoxHostSchema,
    publicPort: singBoxPortSchema.optional(),
    enabled: z.boolean().default(true),
    upMbps: z.number().int().positive().max(10_000_000).nullable().default(null),
    downMbps: z.number().int().positive().max(10_000_000).nullable().default(null),
    ignoreClientBandwidth: z.boolean().default(false),
    obfs: hysteria2ObfsInputSchema.nullable().default(null),
    tls: hysteria2TlsInputSchema,
    masquerade: hysteria2MasqueradeInputSchema.nullable().default(null),
    bindInterface: z.string().trim().min(1).max(64).nullable().default(null),
    routingMark: z.number().int().min(0).max(4_294_967_295).nullable().default(null),
    reuseAddr: z.boolean().default(false),
    netns: singBoxPathSchema.nullable().default(null),
    tcpFastOpen: z.boolean().default(false),
    tcpMultiPath: z.boolean().default(false),
    disableTcpKeepAlive: z.boolean().default(false),
    tcpKeepAlive: singBoxDurationSchema.nullable().default(null),
    tcpKeepAliveInterval: singBoxDurationSchema.nullable().default(null),
    udpFragment: z.boolean().nullable().default(null),
    udpTimeout: singBoxDurationSchema.nullable().default(null),
    detour: singBoxTagSchema.nullable().default(null),
    brutalDebug: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.upMbps === null) !== (value.downMbps === null)) {
      context.addIssue({
        code: 'custom',
        path: ['upMbps'],
        message: 'upMbps and downMbps must both be set or both be null',
      });
    }
    if (
      value.tls.minVersion &&
      value.tls.maxVersion &&
      Number(value.tls.minVersion) > Number(value.tls.maxVersion)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tls', 'maxVersion'],
        message: 'maxVersion cannot be lower than minVersion',
      });
    }
  });
export type Hysteria2InboundSettings = z.infer<typeof hysteria2InboundSettingsSchema>;

const inboundListenCommonFields = {
  listenHost: singBoxHostSchema.default('0.0.0.0'),
  listenPort: singBoxPortSchema,
  publicHost: singBoxHostSchema,
  publicPort: singBoxPortSchema.optional(),
  enabled: z.boolean().default(true),
};

const realityShortIdSchema = z
  .string()
  .max(32)
  .regex(
    /^(?:|[0-9a-fA-F]{2}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{10}|[0-9a-fA-F]{12}|[0-9a-fA-F]{14}|[0-9a-fA-F]{16}|[0-9a-fA-F]{18}|[0-9a-fA-F]{20}|[0-9a-fA-F]{22}|[0-9a-fA-F]{24}|[0-9a-fA-F]{26}|[0-9a-fA-F]{28}|[0-9a-fA-F]{30}|[0-9a-fA-F]{32})$/,
    'short_id must be empty or even-length hex (0-16 bytes)',
  );

export const realityFingerprintSchema = z.enum([
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  '360',
  'qq',
  'random',
  'randomized',
]);

export const vlessFlowSchema = z.enum(['', 'xtls-rprx-vision']);

export const vlessRealityInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    handshakeServer: singBoxHostSchema,
    handshakePort: singBoxPortSchema.default(443),
    serverNames: z.array(singBoxHostSchema).min(1).max(64),
    shortIds: z.array(realityShortIdSchema).min(1).max(64),
    flow: vlessFlowSchema.default('xtls-rprx-vision'),
    transport: z.literal('none').default('none'),
    fingerprint: realityFingerprintSchema.default('chrome'),
    privateKey: z
      .string()
      .min(40)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, 'Expected a base64url Reality private key')
      .optional(),
    publicKey: z
      .string()
      .min(40)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, 'Expected a base64url Reality public key')
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.privateKey === undefined) !== (value.publicKey === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['publicKey'],
        message: 'privateKey and publicKey must both be supplied or both omitted',
      });
    }
  });
export type VlessRealityInboundSettings = z.infer<typeof vlessRealityInboundSettingsSchema>;

export const vlessXhttpModeSchema = z.enum(['auto', 'packet-up', 'stream-up', 'stream-one']);
export type VlessXhttpMode = z.infer<typeof vlessXhttpModeSchema>;

const vlessXhttpPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .startsWith('/')
  .refine(
    (value) => !/[\u0000-\u001f\u007f\s?#]/.test(value),
    'xHTTP path must be an absolute URL path without whitespace, query, or fragment',
  );

export const vlessXhttpTlsFilesInputSchema = z
  .object({
    mode: z.literal('FILES'),
    sni: singBoxHostSchema,
    certificatePath: singBoxPathSchema.optional(),
    keyPath: singBoxPathSchema.optional(),
    certificatePem: z.string().min(1).max(1_000_000).optional(),
    privateKeyPem: z.string().min(1).max(1_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasPaths = value.certificatePath !== undefined || value.keyPath !== undefined;
    const hasInline = value.certificatePem !== undefined || value.privateKeyPem !== undefined;
    if (hasPaths && (!value.certificatePath || !value.keyPath)) {
      context.addIssue({
        code: 'custom',
        path: ['certificatePath'],
        message: 'certificatePath and keyPath must be supplied together',
      });
    }
    if (hasInline && (!value.certificatePem || !value.privateKeyPem)) {
      context.addIssue({
        code: 'custom',
        path: ['certificatePem'],
        message: 'certificatePem and privateKeyPem must be supplied together',
      });
    }
    if (hasPaths === hasInline) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'Xray FILES TLS requires exactly one certificate source: paths or inline PEM',
      });
    }
  });

export const vlessXhttpTlsInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    path: vlessXhttpPathSchema.default('/'),
    host: singBoxHostSchema.nullable().default(null),
    mode: vlessXhttpModeSchema.default('auto'),
    tls: vlessXhttpTlsFilesInputSchema,
  })
  .strict();
export type VlessXhttpTlsInboundSettings = z.infer<typeof vlessXhttpTlsInboundSettingsSchema>;

const vlessGrpcServiceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\u0000-\u001f\u007f\s]/.test(value),
    'gRPC service name must not contain whitespace or control characters',
  );

export const vlessGrpcTlsInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    serviceName: vlessGrpcServiceNameSchema.default('GunService'),
    tls: vlessXhttpTlsFilesInputSchema,
  })
  .strict();
export type VlessGrpcTlsInboundSettings = z.infer<typeof vlessGrpcTlsInboundSettingsSchema>;

export const vlessTcpTlsInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    flow: vlessFlowSchema.default('xtls-rprx-vision'),
    tls: vlessXhttpTlsFilesInputSchema,
  })
  .strict();
export type VlessTcpTlsInboundSettings = z.infer<typeof vlessTcpTlsInboundSettingsSchema>;

export const trojanFallbackInputSchema = z
  .object({
    server: singBoxHostSchema,
    serverPort: singBoxPortSchema.default(80),
  })
  .strict()
  .nullable()
  .default(null);

export const trojanInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    tls: hysteria2TlsInputSchema,
    fallback: trojanFallbackInputSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.tls.minVersion &&
      value.tls.maxVersion &&
      Number(value.tls.minVersion) > Number(value.tls.maxVersion)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tls', 'maxVersion'],
        message: 'maxVersion cannot be lower than minVersion',
      });
    }
  });
export type TrojanInboundSettings = z.infer<typeof trojanInboundSettingsSchema>;

export const trojanTlsInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    tls: vlessXhttpTlsFilesInputSchema,
    fallback: trojanFallbackInputSchema,
  })
  .strict();
export type TrojanTlsInboundSettings = z.infer<typeof trojanTlsInboundSettingsSchema>;

export const shadowsocksMethodSchema = z.enum([
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
]);
export type ShadowsocksMethod = z.infer<typeof shadowsocksMethodSchema>;

function decodeBase64Password(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    return null;
  }
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

const shadowsocks2022PasswordSchema = (byteLength: 16 | 32) =>
  z
    .string()
    .min(1)
    .max(128)
    .superRefine((value, context) => {
      const decoded = decodeBase64Password(value);
      if (!decoded || decoded.byteLength !== byteLength) {
        context.addIssue({
          code: 'custom',
          message: `2022 Shadowsocks password must be base64 of exactly ${byteLength} bytes`,
        });
      }
    });

export const shadowsocksInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    method: shadowsocksMethodSchema,
    password: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.password) {
      return;
    }
    if (value.method === '2022-blake3-aes-128-gcm') {
      const result = shadowsocks2022PasswordSchema(16).safeParse(value.password);
      if (!result.success) {
        context.addIssue({
          code: 'custom',
          path: ['password'],
          message: '2022-blake3-aes-128-gcm password must be base64 of 16 bytes',
        });
      }
      return;
    }
    if (value.method === '2022-blake3-aes-256-gcm') {
      const result = shadowsocks2022PasswordSchema(32).safeParse(value.password);
      if (!result.success) {
        context.addIssue({
          code: 'custom',
          path: ['password'],
          message: '2022-blake3-aes-256-gcm password must be base64 of 32 bytes',
        });
      }
      return;
    }
    const classic = credentialPasswordSchema.safeParse(value.password);
    if (!classic.success) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message:
          'Classic Shadowsocks password must be 8-128 UTF-8 bytes without control characters',
      });
    }
  });
export type ShadowsocksInboundSettings = z.infer<typeof shadowsocksInboundSettingsSchema>;
export const shadowsocksXrayInboundSettingsSchema = shadowsocksInboundSettingsSchema.safeExtend({
  method: z.literal('2022-blake3-aes-256-gcm'),
});

const wireguardKeySchema = z
  .string()
  .min(43)
  .max(44)
  .regex(/^[A-Za-z0-9+/_-]{43}=?$/, 'Expected a base64 WireGuard key');

const wireguardAddressSchema = z
  .string()
  .trim()
  .regex(
    /^(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\/(?:[8-9]|[12]\d|3[0-2])$/,
    'Expected a private IPv4 CIDR',
  );

export const wireguardInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    address: wireguardAddressSchema.default('10.66.0.1/24'),
    mtu: z.number().int().min(576).max(9_000).optional().default(1_420),
    privateKey: wireguardKeySchema.optional(),
    publicKey: wireguardKeySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.privateKey === undefined) !== (value.publicKey === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['publicKey'],
        message: 'privateKey and publicKey must both be supplied or both omitted',
      });
    }
  });
export type WireguardInboundSettings = z.infer<typeof wireguardInboundSettingsSchema>;

export const mtproxySecretModeSchema = z.enum(['CLASSIC', 'SECURE', 'TLS']);
export type MtproxySecretMode = z.infer<typeof mtproxySecretModeSchema>;

/** Raw 16-byte MTProxy secret as 32 lowercase hex chars (no dd/ee prefix). */
export const mtproxyRawSecretSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, 'MTProxy secret must be 32 lowercase hex characters');

export const mtproxyInboundSettingsSchema = z
  .object({
    ...inboundListenCommonFields,
    secretMode: mtproxySecretModeSchema.default('SECURE'),
    tlsDomain: singBoxHostSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.secretMode === 'TLS') {
      const domain = value.tlsDomain?.trim();
      if (!domain) {
        context.addIssue({
          code: 'custom',
          path: ['tlsDomain'],
          message: 'tlsDomain is required when secretMode is TLS',
        });
      }
    }
  });
export type MtproxyInboundSettings = z.infer<typeof mtproxyInboundSettingsSchema>;

export const createInboundSchema = z.discriminatedUnion('protocol', [
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('HYSTERIA2'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: hysteria2InboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('VLESS_REALITY'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: vlessRealityInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('VLESS_XHTTP_TLS'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: vlessXhttpTlsInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('VLESS_GRPC_TLS'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: vlessGrpcTlsInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('VLESS_TCP_TLS'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: vlessTcpTlsInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('TROJAN'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: trojanInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('SHADOWSOCKS'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: shadowsocksInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('WIREGUARD'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: wireguardInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('TROJAN_TLS'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: trojanTlsInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('SHADOWSOCKS_XRAY'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: shadowsocksXrayInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('WIREGUARD_XRAY'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: wireguardInboundSettingsSchema,
    })
    .strict(),
  z
    .object({
      tag: singBoxTagSchema,
      protocol: z.literal('MTPROXY'),
      displayNameTemplate: z.string().trim().max(200).nullable().optional(),
      settings: mtproxyInboundSettingsSchema,
    })
    .strict(),
]);
export type CreateInbound = z.infer<typeof createInboundSchema>;

export const updateInboundSchema = z
  .object({
    tag: singBoxTagSchema.optional(),
    protocol: inboundProtocolSchema.optional(),
    displayNameTemplate: z.string().trim().max(200).nullable().optional(),
    settings: z
      .union([
        hysteria2InboundSettingsSchema,
        vlessRealityInboundSettingsSchema,
        vlessXhttpTlsInboundSettingsSchema,
        vlessGrpcTlsInboundSettingsSchema,
        vlessTcpTlsInboundSettingsSchema,
        trojanInboundSettingsSchema,
        trojanTlsInboundSettingsSchema,
        shadowsocksInboundSettingsSchema,
        wireguardInboundSettingsSchema,
        mtproxyInboundSettingsSchema,
      ])
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export type UpdateInbound = z.infer<typeof updateInboundSchema>;

const tlsPublicCommonFields = {
  sni: singBoxHostSchema,
  alpn: z.array(z.string()),
  minVersion: tlsVersionSchema.optional(),
  maxVersion: tlsVersionSchema.optional(),
  cipherSuites: z.array(z.string()),
  curvePreferences: z.array(tlsCurveSchema),
  kernelTx: z.boolean(),
  kernelRx: z.boolean(),
  clientInsecure: z.boolean(),
};
const acmeDns01PublicSchema = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('alidns'),
      accessKeyId: z.string(),
      accessKeySecretPresent: z.boolean(),
      regionId: z.string().nullable(),
      securityTokenPresent: z.boolean(),
    })
    .strict(),
  z
    .object({
      provider: z.literal('cloudflare'),
      apiTokenPresent: z.boolean(),
      zoneTokenPresent: z.boolean(),
    })
    .strict(),
  z
    .object({
      provider: z.literal('acme-dns'),
      username: z.string(),
      passwordPresent: z.boolean(),
      subdomain: z.string(),
      serverUrl: z.string(),
    })
    .strict(),
]);
const hysteria2TlsPublicSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('FILES'),
      ...tlsPublicCommonFields,
      certificatePath: z.string().nullable(),
      keyPath: z.string().nullable(),
      certificatePemPresent: z.boolean(),
      privateKeyPemPresent: z.boolean(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('ACME'),
      ...tlsPublicCommonFields,
      domains: z.array(z.string()),
      dataDirectory: z.string(),
      defaultServerName: z.string().nullable(),
      email: z.string().nullable(),
      provider: z.string(),
      disableHttpChallenge: z.boolean(),
      disableTlsAlpnChallenge: z.boolean(),
      alternativeHttpPort: z.number().int().nullable(),
      alternativeTlsPort: z.number().int().nullable(),
      externalAccount: z
        .object({
          keyId: z.string(),
          macKeyPresent: z.boolean(),
        })
        .strict()
        .nullable(),
      dns01Challenge: acmeDns01PublicSchema.nullable(),
    })
    .strict(),
]);

export const hysteria2InboundPublicConfigSchema = z
  .object({
    upMbps: z.number().int().positive().nullable(),
    downMbps: z.number().int().positive().nullable(),
    ignoreClientBandwidth: z.boolean(),
    obfs: z
      .object({
        type: z.literal('SALAMANDER'),
        passwordPresent: z.boolean(),
      })
      .strict()
      .nullable(),
    tls: hysteria2TlsPublicSchema,
    masquerade: hysteria2MasqueradeInputSchema.nullable(),
    bindInterface: z.string().nullable(),
    routingMark: z.number().int().nullable(),
    reuseAddr: z.boolean(),
    netns: z.string().nullable(),
    tcpFastOpen: z.boolean(),
    tcpMultiPath: z.boolean(),
    disableTcpKeepAlive: z.boolean(),
    tcpKeepAlive: z.string().nullable(),
    tcpKeepAliveInterval: z.string().nullable(),
    udpFragment: z.boolean().nullable(),
    udpTimeout: z.string().nullable(),
    detour: z.string().nullable(),
    brutalDebug: z.boolean(),
  })
  .strict();
export type Hysteria2InboundPublicConfig = z.infer<typeof hysteria2InboundPublicConfigSchema>;

export const vlessRealityInboundPublicConfigSchema = z
  .object({
    handshakeServer: z.string(),
    handshakePort: z.number().int(),
    serverNames: z.array(z.string()).min(1),
    shortIds: z.array(z.string()).min(1),
    flow: vlessFlowSchema,
    transport: z.literal('none'),
    fingerprint: realityFingerprintSchema,
    publicKeyPresent: z.boolean(),
    privateKeyPresent: z.boolean(),
  })
  .strict();
export type VlessRealityInboundPublicConfig = z.infer<typeof vlessRealityInboundPublicConfigSchema>;

export const vlessXhttpTlsPublicConfigSchema = z
  .object({
    path: vlessXhttpPathSchema,
    host: singBoxHostSchema.nullable(),
    mode: vlessXhttpModeSchema,
    tls: z
      .object({
        mode: z.literal('FILES'),
        sni: singBoxHostSchema,
        certificatePath: z.string().nullable(),
        keyPath: z.string().nullable(),
        certificatePemPresent: z.boolean(),
        privateKeyPemPresent: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type VlessXhttpTlsPublicConfig = z.infer<typeof vlessXhttpTlsPublicConfigSchema>;

const vlessFilesTlsPublicSchema = z
  .object({
    mode: z.literal('FILES'),
    sni: singBoxHostSchema,
    certificatePath: z.string().nullable(),
    keyPath: z.string().nullable(),
    certificatePemPresent: z.boolean(),
    privateKeyPemPresent: z.boolean(),
  })
  .strict();

export const vlessGrpcTlsPublicConfigSchema = z
  .object({
    serviceName: vlessGrpcServiceNameSchema,
    tls: vlessFilesTlsPublicSchema,
  })
  .strict();
export type VlessGrpcTlsPublicConfig = z.infer<typeof vlessGrpcTlsPublicConfigSchema>;

export const vlessTcpTlsPublicConfigSchema = z
  .object({
    flow: vlessFlowSchema,
    tls: vlessFilesTlsPublicSchema,
  })
  .strict();
export type VlessTcpTlsPublicConfig = z.infer<typeof vlessTcpTlsPublicConfigSchema>;

export const trojanInboundPublicConfigSchema = z
  .object({
    tls: hysteria2TlsPublicSchema,
    fallback: z
      .object({
        server: z.string(),
        serverPort: z.number().int(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type TrojanInboundPublicConfig = z.infer<typeof trojanInboundPublicConfigSchema>;

export const trojanTlsInboundPublicConfigSchema = z
  .object({
    tls: vlessFilesTlsPublicSchema,
    fallback: z
      .object({
        server: z.string(),
        serverPort: z.number().int(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type TrojanTlsInboundPublicConfig = z.infer<typeof trojanTlsInboundPublicConfigSchema>;

export const shadowsocksInboundPublicConfigSchema = z
  .object({
    method: shadowsocksMethodSchema,
    passwordPresent: z.boolean(),
  })
  .strict();
export type ShadowsocksInboundPublicConfig = z.infer<typeof shadowsocksInboundPublicConfigSchema>;

export const wireguardInboundPublicConfigSchema = z
  .object({
    address: wireguardAddressSchema,
    mtu: z.number().int().min(576).max(9_000),
    privateKeyPresent: z.boolean(),
    publicKeyPresent: z.boolean(),
  })
  .strict();
export type WireguardInboundPublicConfig = z.infer<typeof wireguardInboundPublicConfigSchema>;

export const mtproxyInboundPublicConfigSchema = z
  .object({
    secretMode: mtproxySecretModeSchema,
    tlsDomain: z.string().nullable(),
  })
  .strict();
export type MtproxyInboundPublicConfig = z.infer<typeof mtproxyInboundPublicConfigSchema>;

const inboundResultCommonFields = {
  id: idSchema,
  tag: z.string(),
  displayNameTemplate: z.string().nullable(),
  revision: z.number().int().positive(),
  needsApply: z.boolean(),
  assignmentCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  disabledAt: isoDateTimeSchema.nullable(),
};

const inboundListenPublicFields = {
  listenHost: z.string(),
  listenPort: z.number().int(),
  publicHost: z.string(),
  publicPort: z.number().int(),
  enabled: z.boolean(),
};

export const inboundResultSchema = z.discriminatedUnion('protocol', [
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('HYSTERIA2'),
      settings: hysteria2InboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('VLESS_REALITY'),
      settings: vlessRealityInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('VLESS_XHTTP_TLS'),
      settings: vlessXhttpTlsPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('VLESS_GRPC_TLS'),
      settings: vlessGrpcTlsPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('VLESS_TCP_TLS'),
      settings: vlessTcpTlsPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('TROJAN'),
      settings: trojanInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('SHADOWSOCKS'),
      settings: shadowsocksInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('WIREGUARD'),
      settings: wireguardInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('TROJAN_TLS'),
      settings: trojanTlsInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('SHADOWSOCKS_XRAY'),
      settings: shadowsocksInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('WIREGUARD_XRAY'),
      settings: wireguardInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
  z
    .object({
      ...inboundResultCommonFields,
      protocol: z.literal('MTPROXY'),
      settings: mtproxyInboundPublicConfigSchema.extend(inboundListenPublicFields),
    })
    .strict(),
]);
export type InboundResult = z.infer<typeof inboundResultSchema>;

export const inboundListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().max(100).optional(),
    protocol: inboundProtocolSchema.optional(),
    enabled: booleanQuerySchema.optional(),
    sortBy: z.enum(['tag', 'listenPort', 'createdAt', 'updatedAt']).default('createdAt'),
    sortOrder: z.enum(SORT_ORDERS).default('desc'),
  })
  .strict();
export type InboundListQuery = z.infer<typeof inboundListQuerySchema>;

export const inboundListResponseSchema = z
  .object({
    items: z.array(inboundResultSchema),
    pagination: paginationMetaSchema,
  })
  .strict();

export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export const assignmentSchema = z
  .object({
    id: idSchema,
    inboundId: idSchema,
    userId: idSchema,
    userIdentity: z.string(),
    userUsername: z.string(),
    status: assignmentStatusSchema,
    credentialName: z.string(),
    credentialVersion: z.number().int().nonnegative(),
    credentialPresent: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    disabledAt: isoDateTimeSchema.nullable(),
    rotatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type AssignmentResult = z.infer<typeof assignmentSchema>;

export const assignmentListQuerySchema = paginationQuerySchema
  .extend({
    status: assignmentStatusSchema.optional(),
    search: z.string().trim().max(128).optional(),
  })
  .strict();
export type AssignmentListQuery = z.infer<typeof assignmentListQuerySchema>;

export const assignmentListResponseSchema = z
  .object({
    items: z.array(assignmentSchema),
    pagination: paginationMetaSchema,
  })
  .strict();

export const addAssignmentSchema = z
  .object({
    userId: idSchema,
    password: credentialPasswordSchema.optional(),
    uuid: idSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.password && value.uuid), {
    message: 'Provide either password or uuid, not both',
  });
export type AddAssignment = z.infer<typeof addAssignmentSchema>;

export const rotateAssignmentCredentialSchema = z
  .object({
    password: credentialPasswordSchema.optional(),
    uuid: idSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.password && value.uuid), {
    message: 'Provide either password or uuid, not both',
  });
export type RotateAssignmentCredential = z.infer<typeof rotateAssignmentCredentialSchema>;

export const hysteria2LinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('HYSTERIA2'),
    uri: z.string().startsWith('hysteria2://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type Hysteria2LinkResult = z.infer<typeof hysteria2LinkSchema>;

export const vlessRealityLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('VLESS_REALITY'),
    uri: z.string().startsWith('vless://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type VlessRealityLinkResult = z.infer<typeof vlessRealityLinkSchema>;

export const vlessXhttpTlsLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('VLESS_XHTTP_TLS'),
    uri: z.string().startsWith('vless://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type VlessXhttpTlsLinkResult = z.infer<typeof vlessXhttpTlsLinkSchema>;

export const vlessGrpcTlsLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('VLESS_GRPC_TLS'),
    uri: z.string().startsWith('vless://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type VlessGrpcTlsLinkResult = z.infer<typeof vlessGrpcTlsLinkSchema>;

export const vlessTcpTlsLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('VLESS_TCP_TLS'),
    uri: z.string().startsWith('vless://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type VlessTcpTlsLinkResult = z.infer<typeof vlessTcpTlsLinkSchema>;

export const trojanLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('TROJAN'),
    uri: z.string().startsWith('trojan://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type TrojanLinkResult = z.infer<typeof trojanLinkSchema>;

export const shadowsocksLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('SHADOWSOCKS'),
    uri: z.string().startsWith('ss://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type ShadowsocksLinkResult = z.infer<typeof shadowsocksLinkSchema>;

export const mtproxyLinkSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    protocol: z.literal('MTPROXY'),
    uri: z.string().min(1),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type MtproxyLinkResult = z.infer<typeof mtproxyLinkSchema>;

export const trojanTlsLinkSchema = trojanLinkSchema.extend({
  protocol: z.literal('TROJAN_TLS'),
});
export const shadowsocksXrayLinkSchema = shadowsocksLinkSchema.extend({
  protocol: z.literal('SHADOWSOCKS_XRAY'),
});
const wireguardLinkBaseSchema = z
  .object({
    assignmentId: idSchema,
    credentialVersion: z.number().int().positive(),
    uri: z.string().startsWith('wg://'),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export const wireguardLinkSchema = wireguardLinkBaseSchema.extend({
  protocol: z.literal('WIREGUARD'),
});
export const wireguardXrayLinkSchema = wireguardLinkBaseSchema.extend({
  protocol: z.literal('WIREGUARD_XRAY'),
});

export const inboundLinkSchema = z.discriminatedUnion('protocol', [
  hysteria2LinkSchema,
  vlessRealityLinkSchema,
  vlessXhttpTlsLinkSchema,
  vlessGrpcTlsLinkSchema,
  vlessTcpTlsLinkSchema,
  trojanLinkSchema,
  trojanTlsLinkSchema,
  shadowsocksLinkSchema,
  shadowsocksXrayLinkSchema,
  wireguardLinkSchema,
  wireguardXrayLinkSchema,
  mtproxyLinkSchema,
]);
export type InboundLinkResult = z.infer<typeof inboundLinkSchema>;

export const subscriptionFormatSchema = z.enum(SUBSCRIPTION_FORMATS);

export const subscriptionQuerySchema = z
  .object({
    format: subscriptionFormatSchema.optional(),
  })
  .strict();
export type SubscriptionQuery = z.infer<typeof subscriptionQuerySchema>;

export const subscriptionInfoSchema = z
  .object({
    identity: z.string(),
    username: z.string(),
    status: userStatusSchema,
    statusReason: userStatusReasonSchema.nullable(),
    expireAt: isoDateTimeSchema.nullable(),
    uploadBytes: byteCountSchema,
    downloadBytes: byteCountSchema,
    totalBytes: byteCountSchema,
    limitBytes: byteCountSchema.nullable(),
    remainingBytes: byteCountSchema.nullable(),
    updateIntervalHours: z.number().int().positive(),
    profileTitle: z.string().min(1).max(200),
    announce: z.string().max(500).nullable(),
    supportUrl: z.string().max(2048).nullable(),
    profileWebPageUrl: z.string().max(2048).nullable(),
    happProviderId: z.string().max(128).nullable(),
    subInfoText: z.string().max(200).nullable(),
    subInfoColor: subscriptionSubInfoColorSchema.nullable(),
    subInfoButtonText: z.string().max(25).nullable(),
    subInfoButtonLink: z.string().max(2048).nullable(),
    subExpireEnabled: z.boolean(),
    subExpireButtonLink: z.string().max(2048).nullable(),
    fallbackUrl: z.string().max(2048).nullable(),
    colorProfile: z.string().max(65_536).nullable(),
    showTrafficLimits: z.boolean(),
    subscriptionUrl: z.url(),
    formats: z.array(subscriptionFormatSchema).length(SUBSCRIPTION_FORMATS.length),
    formatUrls: z
      .object({
        singBox: z.url(),
        links: z.url(),
        clash: z.url(),
      })
      .strict(),
  })
  .strict();
export type SubscriptionInfo = z.infer<typeof subscriptionInfoSchema>;

export const hysteria2SubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('HYSTERIA2'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    password: z.string().min(1),
    tls: z
      .object({
        serverName: z.string().min(1).max(255),
        insecure: z.boolean(),
        alpn: z.array(z.string().min(1).max(64)).max(16),
      })
      .strict(),
    obfs: z
      .object({
        type: z.literal('salamander'),
        password: z.string().min(1),
      })
      .strict()
      .nullable(),
    bandwidth: z
      .object({
        upMbps: z.number().int().positive().nullable(),
        downMbps: z.number().int().positive().nullable(),
      })
      .strict(),
  })
  .strict();
export type Hysteria2SubscriptionEndpoint = z.infer<typeof hysteria2SubscriptionEndpointSchema>;

export const vlessRealitySubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('VLESS_REALITY'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    uuid: idSchema,
    flow: vlessFlowSchema,
    tls: z
      .object({
        serverName: z.string().min(1).max(255),
        fingerprint: realityFingerprintSchema,
        publicKey: z.string().min(1),
        shortId: z.string(),
      })
      .strict(),
  })
  .strict();
export type VlessRealitySubscriptionEndpoint = z.infer<
  typeof vlessRealitySubscriptionEndpointSchema
>;

export const vlessXhttpTlsSubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('VLESS_XHTTP_TLS'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    uuid: idSchema,
    path: z.string().min(1).max(1_024),
    host: z.string().min(1).max(255).nullable(),
    mode: vlessXhttpModeSchema,
    tls: z
      .object({
        serverName: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict();
export type VlessXhttpTlsSubscriptionEndpoint = z.infer<
  typeof vlessXhttpTlsSubscriptionEndpointSchema
>;

export const vlessGrpcTlsSubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('VLESS_GRPC_TLS'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    uuid: idSchema,
    serviceName: z.string().min(1).max(255),
    tls: z
      .object({
        serverName: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict();
export type VlessGrpcTlsSubscriptionEndpoint = z.infer<
  typeof vlessGrpcTlsSubscriptionEndpointSchema
>;

export const vlessTcpTlsSubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('VLESS_TCP_TLS'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    uuid: idSchema,
    flow: vlessFlowSchema,
    tls: z
      .object({
        serverName: z.string().min(1).max(255),
      })
      .strict(),
  })
  .strict();
export type VlessTcpTlsSubscriptionEndpoint = z.infer<typeof vlessTcpTlsSubscriptionEndpointSchema>;

export const trojanSubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('TROJAN'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    password: z.string().min(1),
    tls: z
      .object({
        serverName: z.string().min(1).max(255),
        insecure: z.boolean(),
        alpn: z.array(z.string().min(1).max(64)).max(16),
      })
      .strict(),
  })
  .strict();
export type TrojanSubscriptionEndpoint = z.infer<typeof trojanSubscriptionEndpointSchema>;

export const shadowsocksSubscriptionEndpointSchema = z
  .object({
    protocol: z.literal('SHADOWSOCKS'),
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    method: shadowsocksMethodSchema,
    password: z.string().min(1),
  })
  .strict();
export type ShadowsocksSubscriptionEndpoint = z.infer<typeof shadowsocksSubscriptionEndpointSchema>;

export const trojanTlsSubscriptionEndpointSchema = trojanSubscriptionEndpointSchema.extend({
  protocol: z.literal('TROJAN_TLS'),
});
export type TrojanTlsSubscriptionEndpoint = z.infer<typeof trojanTlsSubscriptionEndpointSchema>;

export const shadowsocksXraySubscriptionEndpointSchema =
  shadowsocksSubscriptionEndpointSchema.extend({
    protocol: z.literal('SHADOWSOCKS_XRAY'),
  });
export type ShadowsocksXraySubscriptionEndpoint = z.infer<
  typeof shadowsocksXraySubscriptionEndpointSchema
>;

const wireguardSubscriptionEndpointBaseSchema = z
  .object({
    tag: z.string().min(1).max(128),
    displayName: z.string().min(1).max(256),
    server: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    privateKey: wireguardKeySchema,
    publicKey: wireguardKeySchema,
    serverPublicKey: wireguardKeySchema,
    address: z.string().min(1).max(64),
    mtu: z.number().int().min(576).max(9_000),
  })
  .strict();
export const wireguardSubscriptionEndpointSchema = wireguardSubscriptionEndpointBaseSchema.extend({
  protocol: z.literal('WIREGUARD'),
});
export const wireguardXraySubscriptionEndpointSchema =
  wireguardSubscriptionEndpointBaseSchema.extend({
    protocol: z.literal('WIREGUARD_XRAY'),
  });
export type WireguardSubscriptionEndpoint = z.infer<typeof wireguardSubscriptionEndpointSchema>;
export type WireguardXraySubscriptionEndpoint = z.infer<
  typeof wireguardXraySubscriptionEndpointSchema
>;

export const subscriptionEndpointSchema = z.discriminatedUnion('protocol', [
  hysteria2SubscriptionEndpointSchema,
  vlessRealitySubscriptionEndpointSchema,
  vlessXhttpTlsSubscriptionEndpointSchema,
  vlessGrpcTlsSubscriptionEndpointSchema,
  vlessTcpTlsSubscriptionEndpointSchema,
  trojanSubscriptionEndpointSchema,
  trojanTlsSubscriptionEndpointSchema,
  shadowsocksSubscriptionEndpointSchema,
  shadowsocksXraySubscriptionEndpointSchema,
  wireguardSubscriptionEndpointSchema,
  wireguardXraySubscriptionEndpointSchema,
]);
export type SubscriptionEndpoint = z.infer<typeof subscriptionEndpointSchema>;

export const subscriptionProfileDescriptorSchema = z
  .object({
    title: z.string().min(1).max(256),
    identity: z.string().min(1).max(128),
    username: z.string().min(1).max(64),
    endpoints: z.array(subscriptionEndpointSchema),
    /** Non-fatal profile notes (e.g. formats that omit unsupported endpoints). */
    warnings: z.array(z.string().min(1).max(512)).max(32).optional(),
  })
  .strict();
export type SubscriptionProfileDescriptor = z.infer<typeof subscriptionProfileDescriptorSchema>;

export const coreApplyEngineResultSchema = z
  .object({
    status: z.enum(['SUCCEEDED', 'FAILED', 'ROLLED_BACK']),
    hash: z.string().length(64).nullable(),
    previousHash: z.string().length(64).nullable(),
    error: z.string().nullable(),
    rollbackOutcome: z.string().nullable(),
  })
  .strict();
export type CoreApplyEngineResult = z.infer<typeof coreApplyEngineResultSchema>;

export const coreApplySummarySchema = z
  .object({
    id: idSchema,
    status: z.enum(CORE_APPLY_STATUSES),
    desiredHash: z.string().length(64).nullable(),
    previousHash: z.string().length(64).nullable(),
    error: z.string().nullable(),
    rollbackOutcome: z.string().nullable(),
    startedAt: isoDateTimeSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
    engineResults: z.partialRecord(z.enum(CORE_ENGINES), coreApplyEngineResultSchema).optional(),
  })
  .strict();
export type CoreApplySummary = z.infer<typeof coreApplySummarySchema>;

export const inboundMutationResultSchema = z
  .object({
    inbound: inboundResultSchema.nullable(),
    apply: coreApplySummarySchema,
  })
  .strict();

export const assignmentMutationResultSchema = z
  .object({
    assignment: assignmentSchema.nullable(),
    apply: coreApplySummarySchema,
  })
  .strict();

export const configPreviewEngineSchema = z
  .object({
    valid: z.boolean(),
    hash: z.string().length(64),
    previousHash: z.string().length(64).nullable(),
    config: z.unknown(),
    diff: z.string(),
    validationError: z.string().nullable(),
  })
  .strict();
export type ConfigPreviewEngine = z.infer<typeof configPreviewEngineSchema>;

/** Top-level fields mirror the primary (SING_BOX / first) engine for older clients. */
export const configPreviewSchema = configPreviewEngineSchema
  .extend({
    engines: z.partialRecord(z.enum(CORE_ENGINES), configPreviewEngineSchema).optional(),
  })
  .strict();
export type ConfigPreviewResult = z.infer<typeof configPreviewSchema>;

export const configApplyRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(1_000),
  })
  .strict();
export type ConfigApplyRequest = z.infer<typeof configApplyRequestSchema>;

export const coreApplyRecordSchema = z
  .object({
    id: idSchema,
    status: z.enum(CORE_APPLY_STATUSES),
    trigger: z.enum(CORE_APPLY_TRIGGERS),
    actorAdminId: idSchema.nullable(),
    actorUsername: z.string().nullable(),
    reason: z.string().nullable(),
    desiredHash: z.string().length(64).nullable(),
    previousHash: z.string().length(64).nullable(),
    configRevision: z.number().int().nullable(),
    configPath: z.string().nullable(),
    diffSummary: z.unknown().nullable(),
    error: z.string().nullable(),
    rollbackOutcome: z.string().nullable(),
    engineResults: z
      .partialRecord(z.enum(CORE_ENGINES), coreApplyEngineResultSchema)
      .nullable()
      .optional(),
    startedAt: isoDateTimeSchema.nullable(),
    appliedAt: isoDateTimeSchema.nullable(),
    rollbackStartedAt: isoDateTimeSchema.nullable(),
    rollbackCompletedAt: isoDateTimeSchema.nullable(),
    completedAt: isoDateTimeSchema.nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type CoreApplyRecordResult = z.infer<typeof coreApplyRecordSchema>;

export const coreApplyListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(CORE_APPLY_STATUSES).optional(),
    trigger: z.enum(CORE_APPLY_TRIGGERS).optional(),
  })
  .strict();
export type CoreApplyListQuery = z.infer<typeof coreApplyListQuerySchema>;

export const coreApplyListResponseSchema = z
  .object({
    items: z.array(coreApplyRecordSchema),
    pagination: paginationMetaSchema,
  })
  .strict();

export const auditActionSchema = z.enum([
  'ADMIN_LOGIN',
  'ADMIN_REFRESH',
  'ADMIN_LOGOUT',
  'ADMIN_TOTP_ENABLE',
  'ADMIN_TOTP_CONFIRM',
  'ADMIN_TOTP_DISABLE',
  'ADMIN_CREATE',
  'ADMIN_UPDATE',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_DELETE',
  'USER_DISABLE',
  'USER_ENABLE',
  'USER_RESET_TRAFFIC',
  'USER_EXTEND',
  'USER_SET_PLAN',
  'USER_ROTATE_SUB',
  'PLAN_CREATE',
  'PLAN_UPDATE',
  'PLAN_DELETE',
  'PLAN_ARCHIVE',
  'INBOUND_CREATE',
  'INBOUND_UPDATE',
  'INBOUND_DELETE',
  'INBOUND_ENABLE',
  'INBOUND_DISABLE',
  'INBOUND_ASSIGNMENT_ADD',
  'INBOUND_ASSIGNMENT_REMOVE',
  'INBOUND_CREDENTIAL_ROTATE',
  'INBOUND_CREDENTIAL_REVEAL',
  'SYSTEM_CONFIG_UPDATE',
  'SYSTEM_USER_STATUS_CHANGE',
  'SYSTEM_TRAFFIC_RESET',
  'CORE_APPLY',
  'BACKUP_CREATE',
  'BACKUP_RESTORE',
]);

export const auditListQuerySchema = paginationQuerySchema
  .extend({
    action: auditActionSchema.optional(),
    actorAdminId: idSchema.optional(),
    resourceType: z.string().trim().min(1).max(100).optional(),
    resourceId: z.string().trim().min(1).max(255).optional(),
    outcome: z.enum(AUDIT_OUTCOMES).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    message: 'from must be before or equal to to',
    path: ['from'],
  });
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditLogSchema = z
  .object({
    id: byteCountSchema,
    actorAdminId: idSchema.nullable(),
    actorUsername: z.string().nullable(),
    action: auditActionSchema,
    outcome: z.enum(AUDIT_OUTCOMES),
    resourceType: z.string().nullable(),
    resourceId: z.string().nullable(),
    requestId: z.string().nullable(),
    ipAddress: z.string().nullable(),
    details: z.unknown().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const auditListResponseSchema = z
  .object({
    items: z.array(auditLogSchema),
    pagination: paginationMetaSchema,
  })
  .strict();

export const createBackupRequestSchema = z
  .object({
    kind: backupKindSchema,
  })
  .strict();
export type CreateBackupRequest = z.infer<typeof createBackupRequestSchema>;

export const backupArtifactResultSchema = z
  .object({
    id: idSchema,
    kind: backupKindSchema,
    status: backupStatusSchema,
    sizeBytes: byteCountSchema.nullable(),
    checksum: z.string().length(64).nullable(),
    encrypted: z.boolean(),
    meta: z.record(z.string(), z.unknown()),
    createdAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    errorMessage: z.string().nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type BackupArtifactResult = z.infer<typeof backupArtifactResultSchema>;

export const backupListQuerySchema = paginationQuerySchema
  .extend({
    kind: backupKindSchema.optional(),
    status: backupStatusSchema.optional(),
  })
  .strict();
export type BackupListQuery = z.infer<typeof backupListQuerySchema>;

export const backupListResponseSchema = z
  .object({
    items: z.array(backupArtifactResultSchema),
    pagination: paginationMetaSchema,
  })
  .strict();
export type BackupListResponse = z.infer<typeof backupListResponseSchema>;

export const restoreBackupRequestSchema = z
  .object({
    confirm: z.literal(true),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type RestoreBackupRequest = z.infer<typeof restoreBackupRequestSchema>;

export const systemSettingsReadOnlySchema = z
  .object({
    corsOriginsCount: z.number().int().nonnegative(),
    workersEnabled: z.boolean(),
    backupDir: z.string().min(1),
    backupRetentionDays: z.number().int().positive(),
    backupEncrypt: z.boolean(),
    nodeEnv: z.enum(['development', 'test', 'production']),
    swaggerEnabled: z.boolean(),
    subPublicBaseUrlEnv: z.string().min(1),
    vpnPublicHost: z.string().nullable(),
    acmeHttpPort: z.number().int().min(1).max(65_535),
    acmeTlsPort: z.number().int().min(1).max(65_535),
    singBoxUdpPort: z.number().int().min(1).max(65_535),
    singBoxTcpPort: z.number().int().min(1).max(65_535),
    singBoxTrojanPort: z.number().int().min(1).max(65_535),
    singBoxSsPort: z.number().int().min(1).max(65_535),
    singBoxWgPort: z.number().int().min(1).max(65_535),
    xrayListenPort: z.number().int().min(1).max(65_535),
    xrayGrpcPort: z.number().int().min(1).max(65_535),
    xrayTcpTlsPort: z.number().int().min(1).max(65_535),
    xrayTrojanPort: z.number().int().min(1).max(65_535),
    xraySsPort: z.number().int().min(1).max(65_535),
    xrayWgPort: z.number().int().min(1).max(65_535),
    mtproxyPortMin: z.number().int().min(1).max(65_535),
    mtproxyPortMax: z.number().int().min(1).max(65_535),
    singBoxEnabled: z.boolean(),
    xrayEnabled: z.boolean(),
    mtproxyEnabled: z.boolean(),
    tlsCertificatePath: z.string().nullable(),
    tlsKeyPath: z.string().nullable(),
    telegramEnvConfigured: z.boolean(),
  })
  .strict();

export const systemSettingsSchema = z
  .object({
    panelUrl: z.string().max(2048).nullable(),
    subPublicBaseUrl: z.string().min(1),
    profileUpdateIntervalHours: z.number().int().min(1).max(168),
    notifyTelegramEnabled: z.boolean(),
    telegramBotTokenConfigured: z.boolean(),
    telegramChatIdConfigured: z.boolean(),
    featureFlags: z.record(z.string(), z.boolean()),
    revision: z.number().int().positive(),
    updatedAt: isoDateTimeSchema.nullable(),
    readOnly: systemSettingsReadOnlySchema,
  })
  .strict();
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const updateSystemSettingsSchema = z
  .object({
    panelUrl: z.union([z.url().max(2048), z.literal(''), z.null()]).optional(),
    subPublicBaseUrl: z
      .url()
      .max(2048)
      .transform((value) => value.replace(/\/+$/, ''))
      .optional(),
    profileUpdateIntervalHours: z.number().int().min(1).max(168).optional(),
    notifyTelegramEnabled: z.boolean().optional(),
    telegramBotToken: z
      .union([z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Invalid Telegram bot token'), z.null()])
      .optional(),
    telegramChatId: z
      .union([
        z.string().regex(/^(?:-?\d+|@[A-Za-z][A-Za-z0-9_]{4,31})$/, 'Invalid Telegram chat id'),
        z.null(),
      ])
      .optional(),
    featureFlags: z.record(z.string(), z.boolean()).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one settings field is required');
export type UpdateSystemSettings = z.infer<typeof updateSystemSettingsSchema>;

export const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      messageRu: z.string(),
      details: z.unknown().optional(),
    }),
    requestId: z.string(),
    timestamp: isoDateTimeSchema,
  })
  .strict();

export const healthStatusSchema = z.enum(['ok', 'error']);
export const dependencyStatusSchema = z.enum(['up', 'down']);

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

export const readinessResponseSchema = z.object({
  status: healthStatusSchema,
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: z.object({
      status: dependencyStatusSchema,
      latencyMs: z.number().nonnegative(),
    }),
    redis: z.object({
      status: dependencyStatusSchema,
      latencyMs: z.number().nonnegative(),
    }),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

function validateUserStatusReason(
  status: z.infer<typeof userStatusSchema>,
  reason: z.infer<typeof userStatusReasonSchema> | null | undefined,
  context: z.RefinementCtx,
): void {
  const expected =
    status === 'ACTIVE'
      ? null
      : status === 'DISABLED'
        ? 'manual'
        : status === 'EXPIRED'
          ? 'expired'
          : undefined;

  if (expected === null && reason != null) {
    context.addIssue({
      code: 'custom',
      path: ['statusReason'],
      message: 'ACTIVE users cannot have a status reason',
    });
  } else if (expected && reason != null && reason !== expected) {
    context.addIssue({
      code: 'custom',
      path: ['statusReason'],
      message: `${status} users must use the ${expected} reason`,
    });
  } else if (
    status === 'LIMITED' &&
    reason != null &&
    !['quota', 'device', 'ip'].includes(reason)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['statusReason'],
      message: 'LIMITED users must use quota, device, or ip',
    });
  }
}

function isSingBoxHost(value: string): boolean {
  if (value.includes(':')) {
    if (!/^[0-9a-f:.]+$/i.test(value)) {
      return false;
    }
    try {
      const url = new URL(`http://[${value}]/`);
      return url.hostname.length > 2;
    } catch {
      return false;
    }
  }
  const parts = value.split('.');
  if (parts.every((part) => /^\d+$/.test(part)) && parts.length === 4) {
    return parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return parts.every(
    (part) =>
      part.length >= 1 &&
      part.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part),
  );
}

function isHttpUrlWithoutCredentials(value: string, requireHttps = false): boolean {
  try {
    const url = new URL(value);
    return (
      (requireHttps ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) &&
      url.username === '' &&
      url.password === '' &&
      ![...url.searchParams.keys()].some((key) =>
        /password|secret|token|credential|api.?key|mac.?key/i.test(key),
      )
    );
  } catch {
    return false;
  }
}
