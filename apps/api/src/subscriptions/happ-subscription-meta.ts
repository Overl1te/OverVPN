import type { SubscriptionInfo } from '@overvpn/shared/schemas';
import { formatSubscriptionUserinfo } from './subscriptions.service';

/** Encode a value as Happ `base64:<utf8-base64>` (HTTP header / body meta). */
export function encodeHappBase64Value(value: string): string {
  return `base64:${Buffer.from(value, 'utf8').toString('base64')}`;
}

/**
 * Happ subscription body meta lines (`#key: value` / `#providerid id`).
 * Mirrors HTTP response headers for clients that only read the body.
 */
export function formatHappSubscriptionBodyMeta(
  info: SubscriptionInfo,
): string[] {
  const lines: string[] = [
    `#profile-update-interval: ${info.updateIntervalHours}`,
    `#profile-title: ${encodeHappBase64Value(info.profileTitle)}`,
    `#subscription-userinfo: ${formatSubscriptionUserinfo(info)}`,
  ];
  if (info.announce) {
    lines.push(`#announce: ${encodeHappBase64Value(info.announce)}`);
  }
  if (info.supportUrl) {
    lines.push(`#support-url: ${info.supportUrl}`);
  }
  if (info.profileWebPageUrl) {
    lines.push(`#profile-web-page-url: ${info.profileWebPageUrl}`);
  }
  if (info.happProviderId) {
    lines.push(`#providerid ${info.happProviderId}`);
  }
  if (info.subInfoText) {
    lines.push(`#sub-info-text: ${encodeHappBase64Value(info.subInfoText)}`);
  }
  if (info.subInfoColor) {
    lines.push(`#sub-info-color: ${info.subInfoColor}`);
  }
  if (info.subInfoButtonText) {
    lines.push(
      `#sub-info-button-text: ${encodeHappBase64Value(info.subInfoButtonText)}`,
    );
  }
  if (info.subInfoButtonLink) {
    lines.push(`#sub-info-button-link: ${info.subInfoButtonLink}`);
  }
  if (info.subExpireEnabled) {
    lines.push('#sub-expire: 1');
  }
  if (info.subExpireButtonLink) {
    lines.push(`#sub-expire-button-link: ${info.subExpireButtonLink}`);
  }
  if (info.fallbackUrl) {
    lines.push(`#fallback-url: ${info.fallbackUrl}`);
  }
  if (info.colorProfile) {
    lines.push(`#color-profile: ${encodeHappBase64Value(info.colorProfile)}`);
  }
  return lines;
}

export function prependHappLinksMeta(
  body: string,
  info: SubscriptionInfo,
): string {
  const meta = formatHappSubscriptionBodyMeta(info);
  if (meta.length === 0) {
    return body;
  }
  const trimmed = body.replace(/^\uFEFF?/, '');
  return `${meta.join('\n')}\n${trimmed}`;
}
