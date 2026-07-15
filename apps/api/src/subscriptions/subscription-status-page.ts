import type { Locale } from '@overvpn/shared/constants';
import { SUPPORTED_LOCALES } from '@overvpn/shared/constants';
import type { SubscriptionInfo } from '@overvpn/shared/schemas';

type StatusPageCopy = {
  status: string;
  expiry: string;
  used: string;
  limit: string;
  remaining: string;
  uploadDownload: string;
  subscription: string;
  copyUrl: string;
  copied: string;
  links: string;
  clash: string;
  singBox: string;
  hintBefore: string;
  hintAfter: string;
  quota: string;
  statusValue: string;
  expireValue: string;
  usedValue: string;
  limitValue: string;
  remainingValue: string;
  uploadValue: string;
  downloadValue: string;
  percentValue: string;
  usedOfLimit: string;
};

const UI = {
  en: {
    status: 'Status',
    expiry: 'Expiry',
    used: 'Used',
    limit: 'Limit',
    remaining: 'Remaining',
    uploadDownload: 'Upload / Download',
    subscription: 'Subscription',
    copyUrl: 'Copy URL',
    copied: 'Copied',
    links: 'Links',
    clash: 'Clash',
    singBox: 'sing-box',
    hintBefore: 'Apps also read machine status at',
    hintAfter:
      '. Use the format links above if your client needs an explicit profile.',
    quota: 'Quota',
  },
  ru: {
    status: 'Статус',
    expiry: 'Срок',
    used: 'Использовано',
    limit: 'Лимит',
    remaining: 'Осталось',
    uploadDownload: 'Отдача / Загрузка',
    subscription: 'Подписка',
    copyUrl: 'Копировать URL',
    copied: 'Скопировано',
    links: 'Ссылки',
    clash: 'Clash',
    singBox: 'sing-box',
    hintBefore: 'Клиенты также читают машинный статус по',
    hintAfter:
      '. Используйте ссылки форматов выше, если клиенту нужен явный профиль.',
    quota: 'Квота',
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(value: string | null | undefined, locale: Locale): string {
  if (value == null || value === '') {
    return locale === 'ru' ? 'Без лимита' : 'Unlimited';
  }
  let n: bigint;
  try {
    n = BigInt(value);
  } catch {
    return value;
  }
  if (n < 0n) {
    return value;
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;
  if (n < 1024n) {
    return `${n.toString()} B`;
  }
  let unit = 0;
  let scaled = Number(n);
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[unit]}`;
}

/** 0–100 percent of quota used; null when unlimited. */
export function quotaUsagePercent(
  usedBytes: string,
  limitBytes: string | null,
): number | null {
  if (limitBytes == null || limitBytes === '') {
    return null;
  }
  try {
    const used = BigInt(usedBytes);
    const limit = BigInt(limitBytes);
    if (limit <= 0n || used < 0n) {
      return null;
    }
    if (used >= limit) {
      return 100;
    }
    return Math.min(100, Number((used * 1000n) / limit) / 10);
  } catch {
    return null;
  }
}

function russianDaysWord(days: number): string {
  const mod100 = days % 100;
  const mod10 = days % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return 'дней';
  }
  if (mod10 === 1) {
    return 'день';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'дня';
  }
  return 'дней';
}

function daysRemaining(
  expireAt: string | null,
  locale: Locale,
  now = new Date(),
): string {
  if (!expireAt) {
    return locale === 'ru' ? 'Без срока' : 'No expiry';
  }
  const expire = new Date(expireAt);
  const ms = expire.getTime() - now.getTime();
  if (Number.isNaN(ms)) {
    return expireAt;
  }
  if (ms <= 0) {
    return locale === 'ru' ? 'Истекла' : 'Expired';
  }
  const days = Math.ceil(ms / (24 * 60 * 60 * 1_000));
  if (locale === 'ru') {
    return `Осталось ${days} ${russianDaysWord(days)}`;
  }
  return days === 1 ? '1 day left' : `${days} days left`;
}

function statusLabel(
  status: SubscriptionInfo['status'],
  locale: Locale,
): string {
  const labels = {
    en: {
      ACTIVE: 'Active',
      DISABLED: 'Disabled',
      EXPIRED: 'Expired',
      LIMITED: 'Limited',
    },
    ru: {
      ACTIVE: 'Активен',
      DISABLED: 'Отключён',
      EXPIRED: 'Истёк',
      LIMITED: 'Ограничен',
    },
  } as const;
  return labels[locale][status] ?? status;
}

/**
 * Prefer the highest-q supported tag from Accept-Language; default to ru.
 */
export function resolveSubscriptionPageLocale(
  acceptLanguage: string | undefined,
): Locale {
  if (!acceptLanguage?.trim()) {
    return 'ru';
  }

  const scored = acceptLanguage
    .split(',')
    .map((entry, index) => {
      const [tagPart = '', ...params] = entry.trim().split(';');
      const tag = tagPart.trim().toLowerCase();
      const qualityParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='));
      const quality = qualityParam ? Number(qualityParam.slice(2)) : 1;
      return {
        tag,
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );

  for (const entry of scored) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(entry.tag)) {
      return entry.tag as Locale;
    }
    const primary = entry.tag.split('-')[0];
    if (primary && (SUPPORTED_LOCALES as readonly string[]).includes(primary)) {
      return primary as Locale;
    }
  }

  return 'ru';
}

function buildCopy(
  info: SubscriptionInfo,
  locale: Locale,
  now = new Date(),
): StatusPageCopy {
  const ui = UI[locale];
  const usedValue = formatBytes(info.totalBytes, locale);
  const limitValue = formatBytes(info.limitBytes, locale);
  const percent = quotaUsagePercent(info.totalBytes, info.limitBytes);
  return {
    ...ui,
    statusValue: statusLabel(info.status, locale),
    expireValue: daysRemaining(info.expireAt, locale, now),
    usedValue,
    limitValue,
    remainingValue: formatBytes(info.remainingBytes, locale),
    uploadValue: formatBytes(info.uploadBytes, locale),
    downloadValue: formatBytes(info.downloadBytes, locale),
    percentValue:
      percent == null ? '' : `${percent.toFixed(percent >= 10 ? 0 : 1)}%`,
    usedOfLimit: `${usedValue} / ${limitValue}`,
  };
}

/**
 * Compact public status page for browsers hitting the subscription URL.
 * VPN clients continue to receive profile bodies via format negotiation.
 */
export function renderSubscriptionStatusPage(
  info: SubscriptionInfo,
  acceptLanguage?: string,
): string {
  const initialLocale = resolveSubscriptionPageLocale(acceptLanguage);
  const packs = {
    en: buildCopy(info, 'en'),
    ru: buildCopy(info, 'ru'),
  } as const;
  const copy = packs[initialLocale];

  const username = escapeHtml(info.username);
  const profileTitle = escapeHtml(info.profileTitle);
  const expireExact = info.expireAt
    ? escapeHtml(
        new Date(info.expireAt).toISOString().slice(0, 16).replace('T', ' '),
      )
    : '—';
  const subUrl = escapeHtml(info.subscriptionUrl);
  const linksUrl = escapeHtml(info.formatUrls.links);
  const clashUrl = escapeHtml(info.formatUrls.clash);
  const singBoxUrl = escapeHtml(info.formatUrls.singBox);
  const encoded = encodeURIComponent(info.subscriptionUrl);
  const happ = escapeHtml(`happ://add/${info.subscriptionUrl}`);
  const hiddify = escapeHtml(`hiddify://import/${info.subscriptionUrl}`);
  const clashDeep = escapeHtml(`clash://install-config?url=${encoded}`);
  const v2rayng = escapeHtml(`v2rayng://install-config?url=${encoded}`);
  const singboxDeep = escapeHtml(
    `sing-box://import-remote-profile?url=${encoded}`,
  );
  const statusClass =
    info.status === 'ACTIVE'
      ? 'ok'
      : info.status === 'DISABLED'
        ? 'bad'
        : 'warn';
  const percent = quotaUsagePercent(info.totalBytes, info.limitBytes);
  const progressClass =
    percent == null
      ? ''
      : percent >= 100
        ? 'full'
        : percent >= 90
          ? 'high'
          : '';
  const progressWidth = percent == null ? 0 : Math.min(100, percent);
  const i18nJson = JSON.stringify(packs).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="${initialLocale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${profileTitle}</title>
  <style>
    :root {
      --bg: #0b1220;
      --card: #121a2b;
      --text: #e8eefc;
      --muted: #9aa8c7;
      --line: #243149;
      --ok: #3dd68c;
      --warn: #f5c84c;
      --bad: #ff6b7a;
      --accent: #6ea8fe;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", "IBM Plex Sans", system-ui, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, #182744 0%, transparent 45%),
        radial-gradient(circle at bottom right, #152033 0%, transparent 40%),
        var(--bg);
      padding: 1.5rem;
    }
    main {
      width: min(40rem, 100%);
      margin: 0 auto;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }
    .brand {
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .lang {
      display: inline-flex;
      gap: 0.25rem;
      border: 1px solid var(--line);
      border-radius: 0.65rem;
      padding: 0.15rem;
      background: #121a2b;
    }
    .lang button {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--muted);
      font: inherit;
      font-size: 0.8rem;
      font-weight: 650;
      letter-spacing: 0.04em;
      padding: 0.35rem 0.55rem;
      border-radius: 0.5rem;
      cursor: pointer;
    }
    .lang button[aria-pressed="true"] {
      background: #1a2438;
      color: var(--text);
    }
    h1 {
      margin: 0 0 1.25rem;
      font-size: 1.75rem;
      font-weight: 650;
    }
    .card {
      background: color-mix(in srgb, var(--card) 92%, white 8%);
      border: 1px solid var(--line);
      border-radius: 1rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .quota-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.75rem;
      margin-bottom: 0.55rem;
    }
    .quota-head .label { color: var(--muted); font-size: 0.9rem; }
    .quota-head .value { font-size: 1.15rem; font-weight: 700; text-align: right; }
    .quota-head .percent {
      color: var(--muted);
      font-weight: 600;
      font-size: 0.95rem;
      margin-left: 0.4rem;
    }
    .bar {
      height: 0.55rem;
      border-radius: 999px;
      background: #1a2438;
      overflow: hidden;
      margin-bottom: 0.85rem;
    }
    .bar > span {
      display: block;
      height: 100%;
      background: var(--accent);
      border-radius: inherit;
    }
    .bar.high > span { background: var(--warn); }
    .bar.full > span { background: var(--bad); }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--line);
    }
    .row:last-child { border-bottom: 0; padding-bottom: 0; }
    .row:first-child { padding-top: 0; }
    .row.primary .value { font-size: 1.05rem; }
    .row.muted .value { font-weight: 500; color: var(--muted); }
    .label { color: var(--muted); }
    .value { font-weight: 600; text-align: right; }
    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
    .status.bad { color: var(--bad); }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    a.btn, button.btn {
      appearance: none;
      border: 1px solid var(--line);
      background: #1a2438;
      color: var(--text);
      text-decoration: none;
      padding: 0.55rem 0.85rem;
      border-radius: 0.65rem;
      font: inherit;
      cursor: pointer;
    }
    a.btn.primary, button.btn.primary {
      background: var(--accent);
      border-color: transparent;
      color: #081018;
      font-weight: 650;
    }
    .hint {
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.45;
      margin: 0.75rem 0 0;
    }
    code {
      display: block;
      margin-top: 0.75rem;
      padding: 0.75rem;
      border-radius: 0.65rem;
      background: #0a101c;
      border: 1px solid var(--line);
      color: #cfe3ff;
      word-break: break-all;
      font-size: 0.82rem;
    }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div class="brand">OverVPN</div>
      <div class="lang" role="group" aria-label="Language">
        <button type="button" data-locale="ru" aria-pressed="${initialLocale === 'ru' ? 'true' : 'false'}">RU</button>
        <button type="button" data-locale="en" aria-pressed="${initialLocale === 'en' ? 'true' : 'false'}">EN</button>
      </div>
    </div>
    <h1>${username}</h1>
    <section class="card">
      <div class="row"><span class="label" data-i18n="status">${escapeHtml(copy.status)}</span><span class="value status ${statusClass}" data-i18n="statusValue">${escapeHtml(copy.statusValue)}</span></div>
      <div class="row"><span class="label" data-i18n="expiry">${escapeHtml(copy.expiry)}</span><span class="value"><span data-i18n="expireValue">${escapeHtml(copy.expireValue)}</span><br /><small style="color:var(--muted);font-weight:500">${expireExact}</small></span></div>
    </section>
    <section class="card">
      <div class="quota-head">
        <span class="label" data-i18n="quota">${escapeHtml(copy.quota)}</span>
        <span class="value">
          <span data-i18n="usedOfLimit">${escapeHtml(copy.usedOfLimit)}</span>
          ${
            percent == null
              ? ''
              : `<span class="percent" data-i18n="percentValue">${escapeHtml(copy.percentValue)}</span>`
          }
        </span>
      </div>
      ${
        percent == null
          ? ''
          : `<div class="bar ${progressClass}" aria-hidden="true"><span style="width:${progressWidth}%"></span></div>`
      }
      <div class="row primary"><span class="label" data-i18n="used">${escapeHtml(copy.used)}</span><span class="value" data-i18n="usedValue">${escapeHtml(copy.usedValue)}</span></div>
      <div class="row primary"><span class="label" data-i18n="limit">${escapeHtml(copy.limit)}</span><span class="value" data-i18n="limitValue">${escapeHtml(copy.limitValue)}</span></div>
      <div class="row primary"><span class="label" data-i18n="remaining">${escapeHtml(copy.remaining)}</span><span class="value" data-i18n="remainingValue">${escapeHtml(copy.remainingValue)}</span></div>
      <div class="row muted"><span class="label" data-i18n="uploadDownload">${escapeHtml(copy.uploadDownload)}</span><span class="value"><span data-i18n="uploadValue">${escapeHtml(copy.uploadValue)}</span> / <span data-i18n="downloadValue">${escapeHtml(copy.downloadValue)}</span></span></div>
    </section>
    <section class="card">
      <div class="label" style="margin-bottom:0.75rem" data-i18n="subscription">${escapeHtml(copy.subscription)}</div>
      <div class="actions">
        <button class="btn primary" type="button" id="copy-url" data-i18n="copyUrl">${escapeHtml(copy.copyUrl)}</button>
        <a class="btn" href="${linksUrl}" data-i18n="links">${escapeHtml(copy.links)}</a>
        <a class="btn" href="${clashUrl}" data-i18n="clash">${escapeHtml(copy.clash)}</a>
        <a class="btn" href="${singBoxUrl}" data-i18n="singBox">${escapeHtml(copy.singBox)}</a>
      </div>
      <code>${subUrl}</code>
      <p class="hint"><span data-i18n="hintBefore">${escapeHtml(copy.hintBefore)}</span> <code style="display:inline;padding:0.1rem 0.35rem">/info</code><span data-i18n="hintAfter">${escapeHtml(copy.hintAfter)}</span></p>
      <div class="actions" style="margin-top:0.85rem">
        <a class="btn" href="${happ}">Happ</a>
        <a class="btn" href="${hiddify}">Hiddify</a>
        <a class="btn" href="${clashDeep}">Clash</a>
        <a class="btn" href="${v2rayng}">v2rayNG</a>
        <a class="btn" href="${singboxDeep}">sing-box</a>
      </div>
    </section>
  </main>
  <script>
    (function () {
      var STORAGE_KEY = 'overvpn.sub.locale';
      var packs = ${i18nJson};
      var subUrl = ${JSON.stringify(info.subscriptionUrl)};
      var current = document.documentElement.lang === 'en' ? 'en' : 'ru';

      function supported(locale) {
        return locale === 'ru' || locale === 'en';
      }

      function fromNavigator() {
        var candidates = [];
        if (typeof navigator !== 'undefined') {
          if (navigator.languages && navigator.languages.length) {
            for (var i = 0; i < navigator.languages.length; i++) {
              candidates.push(navigator.languages[i]);
            }
          }
          if (navigator.language) {
            candidates.push(navigator.language);
          }
        }
        for (var j = 0; j < candidates.length; j++) {
          var tag = String(candidates[j] || '').toLowerCase();
          if (tag.indexOf('ru') === 0) return 'ru';
          if (tag.indexOf('en') === 0) return 'en';
        }
        return null;
      }

      function resolveLocale() {
        try {
          var stored = localStorage.getItem(STORAGE_KEY);
          if (supported(stored)) return stored;
        } catch (e) {}
        return fromNavigator() || current;
      }

      function applyLocale(locale) {
        if (!supported(locale) || !packs[locale]) return;
        current = locale;
        document.documentElement.lang = locale;
        var pack = packs[locale];
        var nodes = document.querySelectorAll('[data-i18n]');
        for (var i = 0; i < nodes.length; i++) {
          var key = nodes[i].getAttribute('data-i18n');
          if (key && Object.prototype.hasOwnProperty.call(pack, key)) {
            nodes[i].textContent = pack[key];
          }
        }
        var buttons = document.querySelectorAll('.lang button[data-locale]');
        for (var b = 0; b < buttons.length; b++) {
          var btnLocale = buttons[b].getAttribute('data-locale');
          buttons[b].setAttribute('aria-pressed', btnLocale === locale ? 'true' : 'false');
        }
      }

      applyLocale(resolveLocale());

      var langButtons = document.querySelectorAll('.lang button[data-locale]');
      for (var k = 0; k < langButtons.length; k++) {
        langButtons[k].addEventListener('click', function (event) {
          var locale = event.currentTarget.getAttribute('data-locale');
          if (!supported(locale)) return;
          try { localStorage.setItem(STORAGE_KEY, locale); } catch (e) {}
          applyLocale(locale);
        });
      }

      var copyBtn = document.getElementById('copy-url');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var label = packs[current] ? packs[current].copyUrl : 'Copy URL';
          var done = packs[current] ? packs[current].copied : 'Copied';
          var reset = function () {
            copyBtn.textContent = label;
          };
          var showDone = function () {
            copyBtn.textContent = done;
            setTimeout(reset, 1400);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(subUrl).then(showDone).catch(function () {
              reset();
            });
          } else {
            reset();
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}

const VPN_CLIENT_UA =
  /(?:mihomo|clash|stash|flclash|v2rayn|v2rayng|v2raytun|shadowrocket|surge|happ|hiddify|nekoray|nekobox|streisand|sing-box|sfa|sfm|sfi)/i;

/**
 * Browsers get the HTML status page; VPN clients and explicit ?format= keep profiles.
 */
export function prefersSubscriptionHtmlPage(
  explicitFormat: string | undefined,
  accept: string | undefined,
  userAgent: string | undefined,
): boolean {
  if (explicitFormat) {
    return false;
  }
  const ua = userAgent ?? '';
  if (VPN_CLIENT_UA.test(ua)) {
    return false;
  }
  const acceptLower = accept?.toLowerCase() ?? '';
  if (acceptLower.includes('text/html')) {
    return true;
  }
  return /\bmozilla\b/i.test(ua);
}
