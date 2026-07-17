import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Column } from '@ant-design/charts';
import { getDashboard, getHostStats, getSystemHealth, getUpdateStatus } from '@/api/system';
import { PageHeader } from '@/components/PageHeader';
import { useSetupProgress, type SetupStepId } from '@/hooks/useSetupProgress';
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
  const setup = useSetupProgress();
  const [usageRange, setUsageRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(29, 'day').startOf('day'),
    dayjs().startOf('day'),
  ]);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', usageRange[0].format('YYYY-MM-DD'), usageRange[1].format('YYYY-MM-DD')],
    queryFn: () =>
      getDashboard({
        from: usageRange[0].format('YYYY-MM-DD'),
        to: usageRange[1].format('YYYY-MM-DD'),
      }),
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

  const stepMeta: Record<SetupStepId, { title: string; cta: string; to: string }> = {
    inbound: {
      title: t('setup.stepInbound'),
      cta: t('setup.createInbound'),
      to: '/inbounds',
    },
    plan: {
      title: t('setup.stepPlan'),
      cta: t('setup.createPlan'),
      to: '/plans',
    },
    user: {
      title: t('setup.stepUser'),
      cta: t('setup.createUser'),
      to: '/users/new',
    },
  };

  return (
    <div>
      <PageHeader title={t('dashboard.title')} />
      {setup.shouldShowChecklist ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {t('setup.checklistTitle')}
                </Typography.Title>
                <Typography.Text type="secondary">{t('setup.checklistSubtitle')}</Typography.Text>
              </div>
              <Space wrap>
                <Progress
                  type="circle"
                  size={48}
                  percent={Math.round((setup.doneCount / setup.totalSteps) * 100)}
                  format={() => `${setup.doneCount}/${setup.totalSteps}`}
                />
                <Link to="/setup">
                  <Button type="primary">{t('setup.openWizard')}</Button>
                </Link>
              </Space>
            </div>
            {setup.steps.map((step) => {
              const meta = stepMeta[step.id];
              return (
                <div key={step.id} className="setup-checklist-item">
                  <Space>
                    {step.done ? (
                      <CheckCircleOutlined style={{ color: '#0f766e' }} />
                    ) : (
                      <CloseCircleOutlined style={{ color: '#94a3b8' }} />
                    )}
                    <Typography.Text delete={step.done}>{meta.title}</Typography.Text>
                  </Space>
                  {!step.done ? (
                    <Link to={meta.to}>
                      <Button size="small">{meta.cta}</Button>
                    </Link>
                  ) : (
                    <Tag color="success">{t('setup.done')}</Tag>
                  )}
                </div>
              );
            })}
          </Space>
        </Card>
      ) : null}
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
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 4 }}>
              {t('dashboard.networkHint')}
            </Typography.Paragraph>
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
              <>
                <Statistic
                  title={t('dashboard.throughput')}
                  value={formatBytesPerSecond(data.traffic.throughput.totalBytesPerSecond)}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('dashboard.throughputHint')}
                </Typography.Text>
              </>
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
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('dashboard.currentTrafficHint')}
            </Typography.Text>
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
            extra={
              <DatePicker.RangePicker
                size="small"
                value={usageRange}
                onChange={(values) => {
                  if (values?.[0] && values[1]) {
                    setUsageRange([values[0], values[1]]);
                  }
                }}
              />
            }
          >
            {data?.traffic.period ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                {t('dashboard.periodTotals', {
                  total: formatBytes(data.traffic.period.totalBytes),
                  upload: formatBytes(data.traffic.period.uploadBytes),
                  download: formatBytes(data.traffic.period.downloadBytes),
                })}
              </Typography.Text>
            ) : null}
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
