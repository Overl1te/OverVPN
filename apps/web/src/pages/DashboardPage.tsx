import { Alert, Card, Col, Progress, Row, Statistic, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Column } from '@ant-design/charts';
import { getDashboard, getHostStats, getSystemHealth, getUpdateStatus } from '@/api/system';
import { PageHeader } from '@/components/PageHeader';
import { formatBytes, formatBytesPerSecond } from '@/utils/format';
import { localizedRuntimeError } from '@/utils/localizeRuntimeError';
import dayjs from 'dayjs';

function memoryPercent(used: string | undefined, total: string | undefined): number {
  if (!used || !total) {
    return 0;
  }
  try {
    const usedN = BigInt(used);
    const totalN = BigInt(total);
    if (totalN <= 0n) {
      return 0;
    }
    return Math.min(100, Number((usedN * 1000n) / totalN) / 10);
  } catch {
    return 0;
  }
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => getDashboard(),
    refetchInterval: 15_000,
  });
  const healthQuery = useQuery({
    queryKey: ['system-health'],
    queryFn: () => getSystemHealth(),
    refetchInterval: 15_000,
  });
  const hostQuery = useQuery({
    queryKey: ['system-host'],
    queryFn: () => getHostStats(),
    refetchInterval: 5_000,
  });
  const updateQuery = useQuery({
    queryKey: ['system-updates'],
    queryFn: () => getUpdateStatus(),
    refetchInterval: 60_000,
  });

  const data = dashboardQuery.data;
  const health = healthQuery.data;
  const host = hostQuery.data;
  const update = updateQuery.data;

  const series =
    data?.traffic.period.series.map((point) => ({
      day: point.day,
      upload: Number(point.uploadBytes),
      download: Number(point.downloadBytes),
    })) ?? [];

  const chartData = series.flatMap((point) => [
    { day: point.day, type: t('app.upload'), value: point.upload },
    { day: point.day, type: t('app.download'), value: point.download },
  ]);

  const ramPercent = memoryPercent(host?.memory.usedBytes, host?.memory.totalBytes);
  const isRu = i18n.language.startsWith('ru');

  return (
    <div>
      <PageHeader title={t('dashboard.title')} />
      {update?.updateAvailable ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message={t('dashboard.updateAvailable', {
            current: update.currentSha?.slice(0, 7) ?? '—',
            latest: update.latestShortSha ?? update.latestSha?.slice(0, 7) ?? '—',
          })}
          description={
            <>
              <div>{isRu ? update.applyHintRu : update.applyHint}</div>
              {update.latestHtmlUrl ? (
                <a href={update.latestHtmlUrl} target="_blank" rel="noreferrer">
                  {t('dashboard.updateChangelog')}
                </a>
              ) : null}
            </>
          }
        />
      ) : null}
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={8}>
          <Card size="small" loading={hostQuery.isLoading}>
            <Typography.Text type="secondary">{t('dashboard.cpu')}</Typography.Text>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
              <Progress
                type="circle"
                percent={host?.cpu.usagePercent ?? 0}
                size={72}
                strokeColor="#0f766e"
                format={(percent) => `${percent ?? 0}%`}
              />
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>
                  {host ? `${host.cpu.usagePercent}%` : '—'}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('dashboard.cpuCores', { count: host?.cpu.cores ?? 0 })}
                </Typography.Text>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card size="small" loading={hostQuery.isLoading}>
            <Typography.Text type="secondary">{t('dashboard.memory')}</Typography.Text>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
              <Progress
                type="circle"
                percent={ramPercent}
                size={72}
                strokeColor="#0e7490"
                format={(percent) => `${percent ?? 0}%`}
              />
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>
                  {host ? formatBytes(host.memory.usedBytes) : '—'}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('dashboard.memoryOf', {
                    total: host ? formatBytes(host.memory.totalBytes) : '—',
                  })}
                </Typography.Text>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={24} lg={8}>
          <Card size="small" loading={hostQuery.isLoading}>
            <Typography.Text type="secondary">{t('dashboard.network')}</Typography.Text>
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={12}>
                <Statistic
                  title={t('dashboard.networkIn')}
                  value={host ? formatBytesPerSecond(host.network.inboundBytesPerSecond) : '—'}
                  valueStyle={{ fontSize: 18 }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('dashboard.networkTotal')}:{' '}
                  {host ? formatBytes(host.network.inboundBytes) : '—'}
                </Typography.Text>
              </Col>
              <Col span={12}>
                <Statistic
                  title={t('dashboard.networkOut')}
                  value={host ? formatBytesPerSecond(host.network.outboundBytesPerSecond) : '—'}
                  valueStyle={{ fontSize: 18 }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('dashboard.networkTotal')}:{' '}
                  {host ? formatBytes(host.network.outboundBytes) : '—'}
                </Typography.Text>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title={t('dashboard.online')} value={data?.online.active ?? '—'} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            {data?.traffic.throughput.available ? (
              <Statistic
                title={t('dashboard.throughput')}
                value={formatBytesPerSecond(data.traffic.throughput.totalBytesPerSecond)}
              />
            ) : (
              <>
                <Typography.Text type="secondary">{t('dashboard.throughput')}</Typography.Text>
                <Alert
                  style={{ marginTop: 8 }}
                  type="warning"
                  showIcon
                  message={t('dashboard.throughputUnavailable')}
                  description={
                    data?.traffic.throughput.available === false
                      ? (localizedRuntimeError(
                          data.traffic.throughput.reason,
                          i18n.language,
                          data.traffic.throughput.reasonRu,
                        ) ?? undefined)
                      : undefined
                  }
                />
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic
              title={t('dashboard.currentTraffic')}
              value={formatBytes(data?.traffic.current.totalBytes)}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Typography.Text type="secondary">{t('dashboard.coreHealth')}</Typography.Text>
            <div style={{ marginTop: 8 }}>
              <Tag color={(health?.core.healthy ?? data?.core.healthy) ? 'green' : 'red'}>
                {(health?.core.healthy ?? data?.core.healthy)
                  ? t('dashboard.healthy')
                  : t('dashboard.unhealthy')}
              </Tag>
              <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>
                {t('dashboard.version')}: {(health?.core.version ?? data?.core.version) || '—'}
                <br />
                {t('dashboard.latency')}: {health?.core.latencyMs ?? data?.core.latencyMs ?? '—'} ms
              </div>
              {Object.entries(health?.core.engines ?? data?.core.engines ?? {}).map(
                ([engine, engineHealth]) => (
                  <div
                    key={engine}
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: '#64748b',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <Tag
                      color={engineHealth.healthy ? 'green' : 'red'}
                      style={{ marginInlineEnd: 0 }}
                    >
                      {t(`enums.coreEngine.${engine}`)}
                    </Tag>
                    <span>
                      {engineHealth.version || '—'} · {engineHealth.latencyMs} ms
                    </span>
                  </div>
                ),
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={10}>
          <Card
            size="small"
            title={t('dashboard.usersByStatus')}
            loading={dashboardQuery.isLoading}
          >
            <Row gutter={8}>
              {(['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'] as const).map((status) => (
                <Col span={12} key={status} style={{ marginBottom: 8 }}>
                  <Statistic
                    title={t(`enums.userStatus.${status}`)}
                    value={data?.users.byStatus[status] ?? 0}
                    valueStyle={{ fontSize: 20 }}
                  />
                </Col>
              ))}
            </Row>
            <Typography.Text type="secondary">
              {t('app.total')}: {data?.users.total ?? 0}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title={t('dashboard.trafficPeriod')}
            loading={dashboardQuery.isLoading}
          >
            {chartData.length > 0 ? (
              <Column
                data={chartData}
                xField="day"
                yField="value"
                seriesField="type"
                isStack
                height={220}
                legend={{ position: 'top' }}
                axis={{
                  y: {
                    labelFormatter: (v: string | number) => formatBytes(Number(v)),
                  },
                }}
              />
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={t('dashboard.workers')}
        style={{ marginTop: 12 }}
        loading={dashboardQuery.isLoading || healthQuery.isLoading}
      >
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          dataSource={health?.workers ?? data?.workers ?? []}
          columns={[
            {
              title: t('app.name'),
              dataIndex: 'name',
              render: (name: string) => t(`enums.workerName.${name}`, { defaultValue: name }),
            },
            {
              title: t('dashboard.workerState'),
              dataIndex: 'state',
              render: (state: string) => (
                <Tag>{t(`enums.workerState.${state}`, { defaultValue: state })}</Tag>
              ),
            },
            {
              title: t('dashboard.lastSuccess'),
              dataIndex: 'lastSuccessAt',
              render: (value: string | null) =>
                value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—',
            },
            {
              title: t('app.error'),
              dataIndex: 'error',
              ellipsis: true,
              render: (value: string | null) => localizedRuntimeError(value, i18n.language) || '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
