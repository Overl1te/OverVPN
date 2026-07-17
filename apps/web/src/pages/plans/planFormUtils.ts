export const GIB = 1024 ** 3;
export const MBPS_TO_BPS = 1_000_000;

export type PlanFormValues = {
  name: string;
  description?: string | null;
  defaultDataLimitGiB?: number | null;
  defaultExpiryDays?: number | null;
  defaultDeviceLimit?: number | null;
  defaultSpeedLimitMbps?: number | null;
  defaultResetStrategy?: string;
  inboundIds?: string[];
  subscriptionTitleTemplate?: string | null;
  subscriptionAnnounce?: string | null;
  subscriptionSupportUrl?: string | null;
  subscriptionWebPageUrl?: string | null;
  subscriptionShowTrafficLimits?: boolean;
  happProviderId?: string | null;
  subscriptionSubInfoText?: string | null;
  subscriptionSubInfoColor?: 'red' | 'blue' | 'green' | null;
  subscriptionSubInfoButtonText?: string | null;
  subscriptionSubInfoButtonLink?: string | null;
  subscriptionSubExpireEnabled?: boolean;
  subscriptionSubExpireButtonLink?: string | null;
  subscriptionFallbackUrlTemplate?: string | null;
  subscriptionColorProfile?: string | null;
};

export function bytesToGiB(bytes: string | null | undefined): number | null {
  if (!bytes) {
    return null;
  }
  try {
    return Number(BigInt(bytes)) / GIB;
  } catch {
    return null;
  }
}

export function giBToBytes(giB: number | null | undefined): string | null {
  if (giB == null || Number.isNaN(giB)) {
    return null;
  }
  return String(Math.round(giB * GIB));
}

export function bpsToMbps(bps: string | null | undefined): number | null {
  if (!bps) {
    return null;
  }
  try {
    return Number(BigInt(bps)) / MBPS_TO_BPS;
  } catch {
    return null;
  }
}

export function mbpsToBps(mbps: number | null | undefined): string | null {
  if (mbps == null || Number.isNaN(mbps) || mbps <= 0) {
    return null;
  }
  return String(Math.round(mbps * MBPS_TO_BPS));
}

export function planFormValuesToPayload(values: PlanFormValues) {
  return {
    name: values.name,
    description: values.description,
    defaultDataLimitBytes: giBToBytes(values.defaultDataLimitGiB),
    defaultExpiryDays: values.defaultExpiryDays,
    defaultDeviceLimit: values.defaultDeviceLimit,
    defaultIpLimit: null,
    defaultSpeedLimitBps: mbpsToBps(values.defaultSpeedLimitMbps),
    defaultResetStrategy: values.defaultResetStrategy,
    inboundIds: values.inboundIds,
    subscriptionTitleTemplate: values.subscriptionTitleTemplate || null,
    subscriptionAnnounce: values.subscriptionAnnounce || null,
    subscriptionSupportUrl: values.subscriptionSupportUrl || null,
    subscriptionWebPageUrl: values.subscriptionWebPageUrl || null,
    subscriptionShowTrafficLimits: values.subscriptionShowTrafficLimits ?? true,
    happProviderId: values.happProviderId || null,
    subscriptionSubInfoText: values.subscriptionSubInfoText || null,
    subscriptionSubInfoColor: values.subscriptionSubInfoColor || null,
    subscriptionSubInfoButtonText: values.subscriptionSubInfoButtonText || null,
    subscriptionSubInfoButtonLink: values.subscriptionSubInfoButtonLink || null,
    subscriptionSubExpireEnabled: values.subscriptionSubExpireEnabled ?? false,
    subscriptionSubExpireButtonLink: values.subscriptionSubExpireButtonLink || null,
    subscriptionFallbackUrlTemplate: values.subscriptionFallbackUrlTemplate || null,
    subscriptionColorProfile: values.subscriptionColorProfile || null,
  };
}

export const defaultPlanFormValues: Partial<PlanFormValues> = {
  defaultResetStrategy: 'NO_RESET',
  inboundIds: [],
  subscriptionShowTrafficLimits: true,
  subscriptionSubExpireEnabled: false,
};
