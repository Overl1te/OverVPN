import { Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CoreEngine } from '@overvpn/shared/constants';
import type { ProxyServerLastHeartbeat, ProxyServerSummary } from '@overvpn/shared/schemas';
import { formatBytesPerSecond } from '@/utils/format';

export function formatLoadPercent(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${Math.round(value * 10) / 10}%`;
}

export function formatLoadNetwork(load: ProxyServerLastHeartbeat['load']): string {
  if (!load) {
    return '—';
  }
  const inbound = load.networkInboundBytesPerSecond;
  const outbound = load.networkOutboundBytesPerSecond;
  if (inbound === undefined && outbound === undefined) {
    return '—';
  }
  return `↓ ${formatBytesPerSecond(inbound ?? 0)} / ↑ ${formatBytesPerSecond(outbound ?? 0)}`;
}

/** Engines from heartbeat filtered to the node's enabledEngines. */
export function ProxyHeartbeatEngines({
  enabledEngines,
  heartbeat,
}: {
  enabledEngines: CoreEngine[];
  heartbeat: ProxyServerLastHeartbeat | null | undefined;
}) {
  const { t } = useTranslation();
  const engines = heartbeat?.engines ?? [];
  if (engines.length === 0) {
    return <Typography.Text type="secondary">{t('proxy.noHeartbeat')}</Typography.Text>;
  }

  const enabled =
    enabledEngines.length > 0
      ? enabledEngines
      : (engines.map((item) => item.engine) as CoreEngine[]);
  const byEngine = new Map(engines.map((item) => [item.engine, item]));

  return (
    <Space size={4} wrap>
      {enabled.map((engine) => {
        const status = byEngine.get(engine);
        const running = status?.running === true;
        return (
          <Tag key={engine} color={running ? 'green' : 'default'}>
            {t(`enums.coreEngine.${engine}`)}
            {running ? '' : ` · ${t('proxy.engineOff')}`}
          </Tag>
        );
      })}
    </Space>
  );
}

export function proxyLoadFromRow(row: ProxyServerSummary): ProxyServerLastHeartbeat['load'] {
  return row.lastHeartbeat?.load ?? null;
}
