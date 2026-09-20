import { randomInt } from 'node:crypto';
import type {
  AmneziawgInboundPublicConfig,
  AmneziawgInboundSettings,
} from '@overvpn/shared/schemas';
import type { WireguardInboundSecrets } from '../core/core-provider';
import { formatUriHost, rfc3986 } from './share-link-utils';
import {
  createWireguardCredential,
  generateWireguardKeypair,
  type WireguardKeypair,
} from './wireguard-domain';

export interface AmneziawgStorage {
  publicConfig: AmneziawgInboundPublicConfig;
  secrets: WireguardInboundSecrets;
}

export function generateAmneziawgObfuscation(): Pick<
  AmneziawgInboundPublicConfig,
  | 'jc'
  | 'jmin'
  | 'jmax'
  | 's1'
  | 's2'
  | 's3'
  | 's4'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'i1'
  | 'i2'
  | 'i3'
  | 'i4'
  | 'i5'
> {
  const jc = randomInt(3, 7);
  const jmin = randomInt(40, 70);
  const jmax = jmin + randomInt(50, 121);
  const s1 = randomInt(15, 151);
  let s2 = randomInt(15, 151);
  while (s1 + 56 === s2) {
    s2 = randomInt(15, 151);
  }
  const [h1, h2, h3, h4] = generateHeaderRanges();
  return {
    jc,
    jmin,
    jmax,
    s1,
    s2,
    s3: randomInt(8, 56),
    s4: randomInt(4, 28),
    h1,
    h2,
    h3,
    h4,
    i1: '<r 128>',
    i2: null,
    i3: null,
    i4: null,
    i5: null,
  };
}

export function buildAmneziawgStorage(
  settings: AmneziawgInboundSettings,
  previous?: AmneziawgStorage,
): AmneziawgStorage {
  const supplied =
    settings.privateKey && settings.publicKey
      ? { privateKey: settings.privateKey, publicKey: settings.publicKey }
      : undefined;
  const keys: WireguardKeypair =
    supplied ?? previous?.secrets ?? generateWireguardKeypair();
  const obfuscation = resolveObfuscation(settings, previous?.publicConfig);
  return {
    publicConfig: {
      address: settings.address,
      mtu: settings.mtu,
      privateKeyPresent: true,
      publicKeyPresent: true,
      ...obfuscation,
    },
    secrets: {
      version: 1,
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
    },
  };
}

export function createAmneziawgCredential(serverAddress: string) {
  return createWireguardCredential(serverAddress);
}

export function buildAmneziawgUri(input: {
  privateKey: string;
  publicKey: string;
  serverPublicKey: string;
  address: string;
  host: string;
  port: number;
  mtu: number;
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  i1: string;
  i2: string | null;
  i3: string | null;
  i4: string | null;
  i5: string | null;
  label: string;
}): string {
  const query = new URLSearchParams({
    public_key: input.publicKey,
    server_public_key: input.serverPublicKey,
    address: input.address,
    mtu: String(input.mtu),
    allowed_ips: '0.0.0.0/0,::/0',
    jc: String(input.jc),
    jmin: String(input.jmin),
    jmax: String(input.jmax),
    s1: String(input.s1),
    s2: String(input.s2),
    s3: String(input.s3),
    s4: String(input.s4),
    h1: input.h1,
    h2: input.h2,
    h3: input.h3,
    h4: input.h4,
    i1: input.i1,
  });
  appendOptional(query, 'i2', input.i2);
  appendOptional(query, 'i3', input.i3);
  appendOptional(query, 'i4', input.i4);
  appendOptional(query, 'i5', input.i5);
  return `awg://${rfc3986(input.privateKey)}@${formatUriHost(input.host)}:${input.port}?${query.toString()}#${rfc3986(input.label)}`;
}

function appendOptional(
  query: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value && value.trim()) {
    query.set(key, value);
  }
}

function resolveObfuscation(
  settings: AmneziawgInboundSettings,
  previous?: AmneziawgInboundPublicConfig,
): ReturnType<typeof generateAmneziawgObfuscation> {
  if (
    settings.jc !== undefined &&
    settings.jmin !== undefined &&
    settings.jmax !== undefined &&
    settings.s1 !== undefined &&
    settings.s2 !== undefined &&
    settings.s3 !== undefined &&
    settings.s4 !== undefined &&
    settings.h1 !== undefined &&
    settings.h2 !== undefined &&
    settings.h3 !== undefined &&
    settings.h4 !== undefined &&
    settings.i1 !== undefined
  ) {
    return {
      jc: settings.jc,
      jmin: settings.jmin,
      jmax: settings.jmax,
      s1: settings.s1,
      s2: settings.s2,
      s3: settings.s3,
      s4: settings.s4,
      h1: settings.h1,
      h2: settings.h2,
      h3: settings.h3,
      h4: settings.h4,
      i1: settings.i1,
      i2: settings.i2 ?? null,
      i3: settings.i3 ?? null,
      i4: settings.i4 ?? null,
      i5: settings.i5 ?? null,
    };
  }
  if (previous) {
    return {
      jc: previous.jc,
      jmin: previous.jmin,
      jmax: previous.jmax,
      s1: previous.s1,
      s2: previous.s2,
      s3: previous.s3,
      s4: previous.s4,
      h1: previous.h1,
      h2: previous.h2,
      h3: previous.h3,
      h4: previous.h4,
      i1: previous.i1,
      i2: previous.i2,
      i3: previous.i3,
      i4: previous.i4,
      i5: previous.i5,
    };
  }
  return generateAmneziawgObfuscation();
}

function generateHeaderRanges(): [string, string, string, string] {
  const spans: Array<{ lo: number; hi: number }> = [];
  const max = 2_147_483_647;
  while (spans.length < 4) {
    const width = randomInt(10_000, 100_001);
    const lo = randomInt(1, max - width);
    const hi = lo + width;
    if (spans.some((span) => !(hi < span.lo || lo > span.hi))) {
      continue;
    }
    spans.push({ lo, hi });
  }
  return spans.map((span) => `${span.lo}-${span.hi}`) as [
    string,
    string,
    string,
    string,
  ];
}
