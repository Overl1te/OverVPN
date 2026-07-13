import type { SubscriptionInfo } from '@overvpn/shared/schemas';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatBytes(value: string | null | undefined): string {
  if (value == null || value === '') {
    return 'Unlimited';
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

function daysRemaining(expireAt: string | null, now = new Date()): string {
  if (!expireAt) {
    return 'No expiry';
  }
  const expire = new Date(expireAt);
  const ms = expire.getTime() - now.getTime();
  if (Number.isNaN(ms)) {
    return expireAt;
  }
  if (ms <= 0) {
    return 'Expired';
  }
  const days = Math.ceil(ms / (24 * 60 * 60 * 1_000));
  return days === 1 ? '1 day left' : `${days} days left`;
}

function statusLabel(status: SubscriptionInfo['status']): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'DISABLED':
      return 'Disabled';
    case 'EXPIRED':
      return 'Expired';
    case 'LIMITED':
      return 'Limited';
    default:
      return status;
  }
}

/**
 * Compact public status page for browsers hitting the subscription URL.
 * VPN clients continue to receive profile bodies via format negotiation.
 */
export function renderSubscriptionStatusPage(info: SubscriptionInfo): string {
  const username = escapeHtml(info.username);
  const status = escapeHtml(statusLabel(info.status));
  const expire = escapeHtml(daysRemaining(info.expireAt));
  const expireExact = info.expireAt
    ? escapeHtml(new Date(info.expireAt).toISOString().slice(0, 16).replace('T', ' '))
    : '—';
  const used = escapeHtml(formatBytes(info.totalBytes));
  const limit = escapeHtml(formatBytes(info.limitBytes));
  const remaining = escapeHtml(formatBytes(info.remainingBytes));
  const upload = escapeHtml(formatBytes(info.uploadBytes));
  const download = escapeHtml(formatBytes(info.downloadBytes));
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

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>OverVPN — ${username}</title>
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
    .brand {
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 0.5rem;
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
    .row {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--line);
    }
    .row:last-child { border-bottom: 0; padding-bottom: 0; }
    .row:first-child { padding-top: 0; }
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
    <div class="brand">OverVPN</div>
    <h1>${username}</h1>
    <section class="card">
      <div class="row"><span class="label">Status</span><span class="value status ${statusClass}">${status}</span></div>
      <div class="row"><span class="label">Expiry</span><span class="value">${expire}<br /><small style="color:var(--muted);font-weight:500">${expireExact}</small></span></div>
      <div class="row"><span class="label">Used</span><span class="value">${used}</span></div>
      <div class="row"><span class="label">Limit</span><span class="value">${limit}</span></div>
      <div class="row"><span class="label">Remaining</span><span class="value">${remaining}</span></div>
      <div class="row"><span class="label">Upload / Download</span><span class="value">${upload} / ${download}</span></div>
    </section>
    <section class="card">
      <div class="label" style="margin-bottom:0.75rem">Subscription</div>
      <div class="actions">
        <button class="btn primary" type="button" onclick="navigator.clipboard.writeText(${JSON.stringify(info.subscriptionUrl)})">Copy URL</button>
        <a class="btn" href="${linksUrl}">Links</a>
        <a class="btn" href="${clashUrl}">Clash</a>
        <a class="btn" href="${singBoxUrl}">sing-box</a>
      </div>
      <code>${subUrl}</code>
      <p class="hint">Apps also read machine status at <code style="display:inline;padding:0.1rem 0.35rem">/info</code>. Use the format links above if your client needs an explicit profile.</p>
      <div class="actions" style="margin-top:0.85rem">
        <a class="btn" href="${happ}">Happ</a>
        <a class="btn" href="${hiddify}">Hiddify</a>
        <a class="btn" href="${clashDeep}">Clash</a>
        <a class="btn" href="${v2rayng}">v2rayNG</a>
        <a class="btn" href="${singboxDeep}">sing-box</a>
      </div>
    </section>
  </main>
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
