import { PRODUCT_NAME } from './constants.js';

export const DEFAULT_SUBSCRIPTION_TITLE_TEMPLATE = `{product} - {username}`;
export const DEFAULT_ENDPOINT_DISPLAY_NAME_TEMPLATE = `{identity} - {tag}`;

export const SUBSCRIPTION_TITLE_MAX_LENGTH = 200;
export const ENDPOINT_DISPLAY_NAME_MAX_LENGTH = 200;
export const SUBSCRIPTION_ANNOUNCE_MAX_LENGTH = 500;

const TEMPLATE_TOKEN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

export type SubscriptionTemplateVars = Record<string, string>;

export type SubscriptionTrafficContext = {
  uploadBytes: bigint;
  downloadBytes: bigint;
  limitBytes: bigint | null;
  expireAt: Date | null;
  now?: Date;
};

export type SubscriptionBrandingContext = {
  username: string;
  identity: string;
  planName?: string | null;
  traffic?: SubscriptionTrafficContext;
};

export type EndpointDisplayNameContext = SubscriptionBrandingContext & {
  tag: string;
  protocol: string;
};

/** Human-readable byte sizes for client-facing templates (B / KB / MB / GB / TB). */
export function formatTemplateBytes(value: bigint | null | undefined): string {
  if (value === null || value === undefined) {
    return '∞';
  }
  if (value < 0n) {
    return '0B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
  let unit = 0;
  let scaled = Number(value);
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  if (unit === 0) {
    return `${value.toString()}B`;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)}${units[unit]}`;
}

export function formatTrafficBar(usedBytes: bigint, limitBytes: bigint | null, width = 10): string {
  const filledChar = '▓';
  const emptyChar = '░';
  if (limitBytes === null || limitBytes <= 0n) {
    return filledChar.repeat(Math.min(2, width)) + emptyChar.repeat(Math.max(0, width - 2));
  }
  const ratio = Math.min(1, Number(usedBytes) / Number(limitBytes));
  const filled = Math.round(ratio * width);
  return filledChar.repeat(filled) + emptyChar.repeat(Math.max(0, width - filled));
}

export function buildSubscriptionTemplateVars(
  context: SubscriptionBrandingContext,
): SubscriptionTemplateVars {
  const traffic = context.traffic;
  const upload = traffic?.uploadBytes ?? 0n;
  const download = traffic?.downloadBytes ?? 0n;
  const used = upload + download;
  const limit = traffic?.limitBytes ?? null;
  const remaining = limit === null ? null : limit > used ? limit - used : 0n;
  const now = traffic?.now ?? new Date();
  const expireAt = traffic?.expireAt ?? null;
  let expireDays = '';
  if (expireAt) {
    const ms = expireAt.getTime() - now.getTime();
    expireDays = String(Math.max(0, Math.ceil(ms / 86_400_000)));
  }

  return {
    product: PRODUCT_NAME,
    username: context.username,
    identity: context.identity,
    plan: context.planName ?? '',
    upload: formatTemplateBytes(upload),
    download: formatTemplateBytes(download),
    used: formatTemplateBytes(used),
    limit: formatTemplateBytes(limit),
    remaining: formatTemplateBytes(remaining),
    expire: expireAt ? expireAt.toISOString().slice(0, 10).split('-').reverse().join('.') : '',
    expireDays,
    trafficBar: formatTrafficBar(used, limit),
  };
}

export function buildEndpointTemplateVars(
  context: EndpointDisplayNameContext,
): SubscriptionTemplateVars {
  return {
    ...buildSubscriptionTemplateVars(context),
    tag: context.tag,
    protocol: context.protocol,
  };
}

export function renderSubscriptionTemplate(
  template: string | null | undefined,
  vars: SubscriptionTemplateVars,
  options?: { fallback?: string; maxLength?: number },
): string {
  const source =
    template === null || template === undefined || template.trim() === ''
      ? (options?.fallback ?? '')
      : template;
  const rendered = source.replace(TEMPLATE_TOKEN, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key] ?? '';
    }
    return '';
  });
  const trimmed = rendered.trim().replace(/\s+/g, ' ');
  const maxLength = options?.maxLength ?? SUBSCRIPTION_TITLE_MAX_LENGTH;
  if (trimmed.length <= maxLength) {
    return trimmed.length > 0 ? trimmed : (options?.fallback ?? trimmed);
  }
  return trimmed.slice(0, maxLength).trim();
}

export function renderSubscriptionTitle(
  template: string | null | undefined,
  context: SubscriptionBrandingContext,
): string {
  const vars = buildSubscriptionTemplateVars(context);
  const fallback = renderSubscriptionTemplate(DEFAULT_SUBSCRIPTION_TITLE_TEMPLATE, vars, {
    maxLength: SUBSCRIPTION_TITLE_MAX_LENGTH,
  });
  const rendered = renderSubscriptionTemplate(template, vars, {
    fallback,
    maxLength: SUBSCRIPTION_TITLE_MAX_LENGTH,
  });
  return rendered.length > 0 ? rendered : fallback;
}

export function renderEndpointDisplayName(
  template: string | null | undefined,
  context: EndpointDisplayNameContext,
): string {
  const vars = buildEndpointTemplateVars(context);
  const fallback = renderSubscriptionTemplate(DEFAULT_ENDPOINT_DISPLAY_NAME_TEMPLATE, vars, {
    maxLength: ENDPOINT_DISPLAY_NAME_MAX_LENGTH,
  });
  const rendered = renderSubscriptionTemplate(template, vars, {
    fallback,
    maxLength: ENDPOINT_DISPLAY_NAME_MAX_LENGTH,
  });
  return rendered.length > 0 ? rendered : fallback;
}

export function renderSubscriptionAnnounce(
  template: string | null | undefined,
  context: SubscriptionBrandingContext,
): string | null {
  if (template === null || template === undefined || template.trim() === '') {
    return null;
  }
  const rendered = renderSubscriptionTemplate(template, buildSubscriptionTemplateVars(context), {
    maxLength: SUBSCRIPTION_ANNOUNCE_MAX_LENGTH,
  });
  return rendered.length > 0 ? rendered : null;
}

/** Ensure Clash / sing-box names stay unique; stable order by input sequence. */
export function uniquifyDisplayNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = name.trim().length > 0 ? name.trim() : 'endpoint';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      return base;
    }
    const suffix = ` #${count + 1}`;
    const maxBase = ENDPOINT_DISPLAY_NAME_MAX_LENGTH - suffix.length;
    return `${base.slice(0, Math.max(1, maxBase))}${suffix}`;
  });
}
