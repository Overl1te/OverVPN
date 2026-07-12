import { Card, Col, Row, Statistic, Table, Tag, Typography, Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Column } from '@ant-design/charts';
import { getDashboard, getSystemHealth } from '@/api/system';
import { PageHeader } from '@/components/PageHeader';
import { formatBytes, formatBytesPerSecond } from '@/utils/format';
import dayjs from 'dayjs';

export function DashboardPage() {
  const { t } = useTranslation();
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

  const data = dashboardQuery.data;
  const health = healthQuery.data;

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

  return (
    <div>
      <PageHeader title={t('dashboard.title')} />
      <Row gutter={[12, 12]}>
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
                      ? data.traffic.throughput.reason
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
            { title: t('app.name'), dataIndex: 'name' },
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
              render: (value: string | null) => value || '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
