import type { CoreEngine } from '@overvpn/shared/constants';
import type {
  Hysteria2InboundPublicConfig,
  ShadowsocksInboundPublicConfig,
  TrojanInboundPublicConfig,
  VlessRealityInboundPublicConfig,
  VlessXhttpTlsPublicConfig,
} from '@overvpn/shared/schemas';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Hysteria2InboundSecrets {
  version: 1;
  obfsPassword?: string;
  certificatePem?: string;
  privateKeyPem?: string;
  acmeExternalAccountMacKey?: string;
  acmeAliDnsAccessKeySecret?: string;
  acmeAliDnsSecurityToken?: string;
  acmeCloudflareApiToken?: string;
  acmeCloudflareZoneToken?: string;
  acmeDnsPassword?: string;
}

export interface VlessRealityInboundSecrets {
  version: 1;
  privateKey: string;
  publicKey: string;
}

export interface VlessXhttpTlsInboundSecrets {
  version: 1;
  certificatePem?: string;
  privateKeyPem?: string;
}

export interface TrojanInboundSecrets {
  version: 1;
  certificatePem?: string;
  privateKeyPem?: string;
  acmeExternalAccountMacKey?: string;
  acmeAliDnsAccessKeySecret?: string;
  acmeAliDnsSecurityToken?: string;
  acmeCloudflareApiToken?: string;
  acmeCloudflareZoneToken?: string;
  acmeDnsPassword?: string;
}

export interface ShadowsocksInboundSecrets {
  version: 1;
  serverPassword: string;
}

export interface PasswordCredential {
  version: 1;
  password: string;
}

/** @deprecated Prefer PasswordCredential; kept for HY2 call sites. */
export type Hysteria2Credential = PasswordCredential;

export interface VlessCredential {
  version: 1;
  uuid: string;
}

export type AssignmentCredential = PasswordCredential | VlessCredential;

export interface DesiredAssignment {
  id: string;
  userId: string;
  userIdentity: string;
  credentialName: string;
  credentialVersion: number;
  credential: AssignmentCredential;
}

interface DesiredInboundBase {
  id: string;
  tag: string;
  listenHost: string;
  listenPort: number;
  publicHost: string;
  publicPort: number;
  revision: number;
  assignments: DesiredAssignment[];
}

export interface DesiredHysteria2Inbound extends DesiredInboundBase {
  protocol: 'HYSTERIA2';
  config: Hysteria2InboundPublicConfig;
  secrets: Hysteria2InboundSecrets;
}

export interface DesiredVlessRealityInbound extends DesiredInboundBase {
  protocol: 'VLESS_REALITY';
  config: VlessRealityInboundPublicConfig;
  secrets: VlessRealityInboundSecrets;
}

export interface DesiredVlessXhttpTlsInbound extends DesiredInboundBase {
  protocol: 'VLESS_XHTTP_TLS';
  config: VlessXhttpTlsPublicConfig;
  secrets: VlessXhttpTlsInboundSecrets;
}

export interface DesiredTrojanInbound extends DesiredInboundBase {
  protocol: 'TROJAN';
  config: TrojanInboundPublicConfig;
  secrets: TrojanInboundSecrets;
}

export interface DesiredShadowsocksInbound extends DesiredInboundBase {
  protocol: 'SHADOWSOCKS';
  config: ShadowsocksInboundPublicConfig;
  secrets: ShadowsocksInboundSecrets;
}

export type DesiredInbound =
  | DesiredHysteria2Inbound
  | DesiredVlessRealityInbound
  | DesiredVlessXhttpTlsInbound
  | DesiredTrojanInbound
  | DesiredShadowsocksInbound;

export interface CoreDesiredState {
  engine: CoreEngine;
  loadedAt: Date;
  desiredRevision: number;
  inbounds: DesiredInbound[];
  inboundRevisions: Array<{ id: string; revision: number }>;
  userRevisions: Array<{ id: string; revision: number }>;
}

export interface RenderedCoreConfig {
  config: JsonObject;
  canonical: string;
  redactedConfig: JsonObject;
  redactedCanonical: string;
  hash: string;
  secretValues: string[];
}

export interface CoreValidationResult {
  valid: boolean;
  command: string;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  error: string | null;
}

export type RollbackOutcome = 'NOT_REQUIRED' | 'SUCCEEDED' | 'FAILED';

export interface CoreProviderApplyResult {
  status: 'SUCCEEDED' | 'ROLLED_BACK' | 'FAILED';
  desiredHash: string;
  previousHash: string | null;
  appliedAt: Date | null;
  completedAt: Date;
  error: string | null;
  rollbackOutcome: RollbackOutcome;
  rollbackStartedAt: Date | null;
  rollbackCompletedAt: Date | null;
}

export interface CoreHealthResult {
  healthy: boolean;
  version: string | null;
  latencyMs: number;
  checkedAt: Date;
  error: string | null;
  errorRu: string | null;
}

export interface TrafficCounter {
  engine: CoreEngine;
  scope: 'user' | 'inbound' | 'outbound';
  key: string;
  uplinkBytes: string;
  downlinkBytes: string;
}

export type TrafficSnapshotResult =
  | {
      supported: true;
      capturedAt: Date;
      counters: TrafficCounter[];
    }
  | {
      supported: false;
      capturedAt: Date;
      error: {
        code: 'UNSUPPORTED' | 'UNAVAILABLE' | 'QUERY_FAILED';
        message: string;
        messageRu: string;
      };
    };

export interface OnlineClient {
  engine: CoreEngine;
  connectionId: string;
  panelUserId: string | null;
  userName: string | null;
  inboundTag: string | null;
  ipAddress: string | null;
  device: string | null;
  network: string | null;
  connectedAt: Date | null;
  lastSeenAt: Date | null;
  uploadBytes: string | null;
  downloadBytes: string | null;
}

export interface OnlineClientsResult {
  capturedAt: Date;
  clients: OnlineClient[];
  partial: boolean;
  warnings: string[];
}

export type EngineResultMap<T> = Partial<Record<CoreEngine, T>>;

export interface AggregatedCoreHealthResult extends CoreHealthResult {
  engines: EngineResultMap<CoreHealthResult>;
}

export type AggregatedTrafficSnapshotResult = TrafficSnapshotResult & {
  engines: EngineResultMap<TrafficSnapshotResult>;
  partial: boolean;
  warnings: string[];
};

export interface AggregatedOnlineClientsResult extends OnlineClientsResult {
  engines: EngineResultMap<OnlineClientsResult>;
}

export abstract class CoreProvider {
  abstract renderConfig(state: CoreDesiredState): RenderedCoreConfig;
  abstract validate(config: RenderedCoreConfig): Promise<CoreValidationResult>;
  abstract apply(config: RenderedCoreConfig): Promise<CoreProviderApplyResult>;
  abstract health(): Promise<CoreHealthResult>;
  abstract getTrafficSnapshot(): Promise<TrafficSnapshotResult>;
  abstract getOnlineClients(): Promise<OnlineClientsResult>;
}

export abstract class EngineProvider<
  TEngine extends CoreEngine = CoreEngine,
> extends CoreProvider {
  abstract readonly engine: TEngine;
}
