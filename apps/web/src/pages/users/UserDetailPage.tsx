import {
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Line } from '@ant-design/charts';
import {
  createUser,
  getUser,
  getUserConnectionIdentities,
  getUserSessions,
  getUserUsage,
  resetUserTraffic,
  rotateUserSub,
  updateUser,
} from '@/api/users';
import { listPlans } from '@/api/plans';
import { listAssignments, listInbounds } from '@/api/inbounds';
import { getSettings } from '@/api/settings';
import { PageHeader } from '@/components/PageHeader';
import { UserStatusTag } from '@/components/StatusTag';
import { CopyButton } from '@/components/CopyButton';
import { QrModal } from '@/components/QrModal';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { buildSubscriptionClientLinks, buildSubscriptionUrl, formatBytes } from '@/utils/format';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const { canMutate } = useAuth();
  const [form] = Form.useForm();
  const [qrOpen, setQrOpen] = useState(false);
  const [usageRange, setUsageRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(29, 'day').startOf('day'),
    dayjs().startOf('day'),
  ]);

  const userQuery = useQuery({
    queryKey: ['user', id],
    queryFn: () => getUser(id!),
    enabled: !isNew && !!id,
  });

  const usageQuery = useQuery({
    queryKey: [
      'user-usage',
      id,
      usageRange[0].format('YYYY-MM-DD'),
      usageRange[1].format('YYYY-MM-DD'),
    ],
    queryFn: () =>
      getUserUsage(id!, {
        from: usageRange[0].format('YYYY-MM-DD'),
        to: usageRange[1].format('YYYY-MM-DD'),
      }),
    enabled: !isNew && !!id,
  });

  const sessionsQuery = useQuery({
    queryKey: ['user-sessions', id],
    queryFn: () => getUserSessions(id!),
    enabled: !isNew && !!id,
  });

  const identitiesQuery = useQuery({
    queryKey: ['user-connection-identities', id],
    queryFn: () => getUserConnectionIdentities(id!),
    enabled: !isNew && !!id,
    refetchInterval: 15_000,
  });

  const plansQuery = useQuery({
    queryKey: ['plans', 'all'],
    queryFn: () => listPlans({ page: 1, pageSize: 100 }),
  });

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', 'all'],
    queryFn: () => listInbounds({ page: 1, pageSize: 100 }),
    enabled: !isNew,
  });

  const assignmentsQueries = useQuery({
    queryKey: ['user-assignments', id, inboundsQuery.data?.items.map((i) => i.id)],
    enabled: !isNew && !!id && !!inboundsQuery.data?.items.length,
    queryFn: async () => {
      const inbounds = inboundsQuery.data!.items;
      const results = await Promise.all(
        inbounds.map(async (inbound) => {
          const page = await listAssignments(inbound.id, { page: 1, pageSize: 100 });
          return page.items
            .filter((item) => item.userId === id)
            .map((item) => ({ ...item, inboundTag: inbound.tag, inboundId: inbound.id }));
        }),
      );
      return results.flat();
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: !isNew,
  });

  const planOptions = useMemo(
    () =>
      (plansQuery.data?.items ?? [])
        .filter((plan) => plan.status === 'ACTIVE' || plan.id === userQuery.data?.planId)
        .map((plan) => ({
          value: plan.id,
          label: plan.name,
        })),
    [plansQuery.data, userQuery.data?.planId],
  );

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = {
        username: values.username as string,
        status: values.status as string | undefined,
        planId: values.planId as string,
      };

      return isNew ? await createUser(payload as never) : await updateUser(id!, payload as never);
    },
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', user.id] });
      void queryClient.invalidateQueries({ queryKey: ['user-assignments', user.id] });
      void queryClient.invalidateQueries({ queryKey: ['assignments'] });
      if (isNew) {
        navigate(`/users/${user.id}`, { replace: true });
      }
    },
    onError: onError,
  });

  const rotateMutation = useMutation({
    mutationFn: () => rotateUserSub(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user', id] });
    },
    onError: onError,
  });

  const resetMutation = useMutation({
    mutationFn: () => resetUserTraffic(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user', id] });
      void queryClient.invalidateQueries({ queryKey: ['user-usage', id] });
    },
    onError: onError,
  });

  const user = userQuery.data;
  const subBaseUrl = settingsQuery.data?.subPublicBaseUrl;
  const subUrl = user && subBaseUrl ? buildSubscriptionUrl(user.subToken, subBaseUrl) : '';
  const clientLinks = useMemo(() => (subUrl ? buildSubscriptionClientLinks(subUrl) : []), [subUrl]);
  const formatUrls = useMemo(
    () =>
      subUrl
        ? {
            links: `${subUrl}?format=links`,
            clash: `${subUrl}?format=clash`,
            singBox: `${subUrl}?format=sing-box`,
          }
        : null,
    [subUrl],
  );

  const chartData =
    usageQuery.data?.series.flatMap((point) => [
      { day: point.day, type: t('app.upload'), value: Number(point.uploadBytes) },
      { day: point.day, type: t('app.download'), value: Number(point.downloadBytes) },
    ]) ?? [];

  useEffect(() => {
    if (user) {
      form.setFieldsValue({
        username: user.username,
        status: user.status,
        planId: user.planId,
      });
    }
  }, [user, form]);

  if (!isNew && userQuery.isLoading) {
    return null;
  }

  return (
    <div>
      <PageHeader
        title={isNew ? t('users.create') : t('users.detail')}
        extra={
          <Space>
            <Link to="/users">{t('app.back')}</Link>
            {!isNew && user ? (
              <>
                <UserStatusTag status={user.status} reason={user.statusReason} />
                {user.needsApply ? <Tag color="orange">{t('users.needsApply')}</Tag> : null}
              </>
            ) : null}
          </Space>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={10}>
          <Card size="small" title={t('users.profile')}>
            <Form
              form={form}
              layout="vertical"
              disabled={!canMutate}
              initialValues={{ status: 'ACTIVE' }}
              onFinish={(values) => saveMutation.mutate(values)}
            >
              <Form.Item name="username" label={t('users.username')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>

              <Form.Item
                name="planId"
                label={t('users.plan')}
                rules={[{ required: true, message: t('users.planRequired') }]}
                extra={<Typography.Text type="secondary">{t('users.planHint')}</Typography.Text>}
              >
                <Select options={planOptions} placeholder={t('users.plan')} />
              </Form.Item>

              <Form.Item name="status" label={t('app.status')} rules={[{ required: true }]}>
                <Select
                  options={['ACTIVE', 'DISABLED'].map((value) => ({
                    value,
                    label: t(`enums.userStatus.${value}`),
                  }))}
                />
              </Form.Item>

              <MutateOnly>
                <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                  {t('app.save')}
                </Button>
              </MutateOnly>
            </Form>
          </Card>

          {!isNew && user ? (
            <>
              <Card size="small" title={t('users.limits')} style={{ marginTop: 12 }}>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label={t('users.expireAt')}>
                    {user.expireAt ? dayjs(user.expireAt).format('YYYY-MM-DD HH:mm') : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('users.limit')}>
                    {user.dataLimitBytes ? formatBytes(user.dataLimitBytes) : t('app.unlimited')}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('users.usage')}>
                    {formatBytes(user.usedUploadBytes)} ↑ / {formatBytes(user.usedDownloadBytes)} ↓
                  </Descriptions.Item>
                  <Descriptions.Item label={t('users.deviceLimit')}>
                    {user.deviceLimit ?? t('app.unlimited')}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('users.resetStrategy')}>
                    {t(`enums.resetStrategy.${user.resetStrategy}`, {
                      defaultValue: user.resetStrategy,
                    })}
                  </Descriptions.Item>
                </Descriptions>
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  {t('users.limitsFromPlan')}
                </Typography.Paragraph>
              </Card>

              <Card size="small" title={t('users.subscription')} style={{ marginTop: 12 }}>
                {subUrl ? (
                  <Typography.Paragraph
                    copyable={{ text: subUrl }}
                    style={{ wordBreak: 'break-all' }}
                  >
                    {subUrl}
                  </Typography.Paragraph>
                ) : (
                  <Typography.Paragraph type="secondary">
                    {t('users.subscriptionLoading')}
                  </Typography.Paragraph>
                )}
                <Space wrap>
                  {subUrl ? <CopyButton value={subUrl} /> : null}
                  <Button size="small" disabled={!subUrl} onClick={() => setQrOpen(true)}>
                    {t('app.showQr')}
                  </Button>
                  <MutateOnly>
                    <Popconfirm
                      title={t('users.confirmRotateOne')}
                      onConfirm={() => rotateMutation.mutate()}
                    >
                      <Button size="small" loading={rotateMutation.isPending}>
                        {t('app.rotateSub')}
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title={t('users.confirmResetOne')}
                      onConfirm={() => resetMutation.mutate()}
                    >
                      <Button size="small" loading={resetMutation.isPending}>
                        {t('app.resetTraffic')}
                      </Button>
                    </Popconfirm>
                  </MutateOnly>
                </Space>

                {formatUrls ? (
                  <div style={{ marginTop: 12 }}>
                    <Typography.Text type="secondary">
                      {t('users.subscriptionFormats')}
                    </Typography.Text>
                    <Space wrap style={{ marginTop: 6 }}>
                      <CopyButton value={formatUrls.links} label={t('users.formatLinks')} />
                      <CopyButton value={formatUrls.clash} label={t('users.formatClash')} />
                      <CopyButton value={formatUrls.singBox} label={t('users.formatSingBox')} />
                    </Space>
                  </div>
                ) : null}

                {clientLinks.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <Typography.Text type="secondary">{t('users.clientLinks')}</Typography.Text>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ marginTop: 4, marginBottom: 6 }}
                    >
                      {t('users.clientLinksHint')}
                    </Typography.Paragraph>
                    <Space wrap>
                      {clientLinks.map((link) => (
                        <CopyButton
                          key={link.id}
                          value={link.href}
                          label={t(`users.clientLink.${link.id}`)}
                        />
                      ))}
                    </Space>
                  </div>
                ) : null}
              </Card>
            </>
          ) : null}
        </Col>

        <Col xs={24} lg={14}>
          {!isNew ? (
            <>
              <Card
                size="small"
                title={t('users.usageChart')}
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
                {usageQuery.data ? (
                  <>
                    <Typography.Text type="secondary">
                      {t('app.periodRemaining', {
                        period: formatBytes(usageQuery.data.periodTotalBytes),
                        remaining: usageQuery.data.remainingBytes
                          ? formatBytes(usageQuery.data.remainingBytes)
                          : t('app.unlimited'),
                      })}
                    </Typography.Text>
                    <Line
                      data={chartData}
                      xField="day"
                      yField="value"
                      seriesField="type"
                      height={220}
                      axis={{
                        y: {
                          labelFormatter: (v: string | number) => formatBytes(Number(v)),
                        },
                      }}
                    />
                  </>
                ) : null}
              </Card>

              <Card size="small" title={t('users.connectionIdentities')} style={{ marginTop: 12 }}>
                {identitiesQuery.data ? (
                  <>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                      {t('users.connectionIdentitiesHint')}
                    </Typography.Paragraph>
                    <Space wrap style={{ marginBottom: 12 }}>
                      <Tag>
                        {t('users.lookbackMinutes', {
                          minutes: Math.round(identitiesQuery.data.lookbackMs / 60_000),
                        })}
                      </Tag>
                      <Tag>
                        {t('users.identityCounts', {
                          devices: identitiesQuery.data.deviceCount,
                          deviceLimit: identitiesQuery.data.deviceLimit
                            ? t('users.limitOf', { limit: identitiesQuery.data.deviceLimit })
                            : '',
                          online: identitiesQuery.data.ips.filter((row) => row.online).length,
                        })}
                      </Tag>
                      {identitiesQuery.data.identityLimitHoldUntil ? (
                        <Tag color="warning">
                          {t('users.identityHoldUntil', {
                            time: dayjs(identitiesQuery.data.identityLimitHoldUntil).format(
                              'YYYY-MM-DD HH:mm',
                            ),
                          })}
                        </Tag>
                      ) : null}
                    </Space>
                    <Table
                      size="small"
                      rowKey="key"
                      pagination={false}
                      dataSource={identitiesQuery.data.ips}
                      locale={{ emptyText: '—' }}
                      columns={[
                        { title: t('online.ip'), dataIndex: 'ipAddress' },
                        {
                          title: t('users.sessionCount'),
                          dataIndex: 'sessionCount',
                          width: 90,
                        },
                        {
                          title: t('users.onlineNow'),
                          dataIndex: 'online',
                          width: 90,
                          render: (online: boolean) =>
                            online ? <Tag color="success">online</Tag> : <Tag>off</Tag>,
                        },
                        {
                          title: t('users.firstSeen'),
                          dataIndex: 'firstSeenAt',
                          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                        },
                        {
                          title: t('users.lastSeen'),
                          dataIndex: 'lastSeenAt',
                          render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                        },
                      ]}
                    />
                  </>
                ) : null}
              </Card>

              <Card size="small" title={t('users.sessions')} style={{ marginTop: 12 }}>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={sessionsQuery.data ?? []}
                  columns={[
                    { title: t('app.key'), dataIndex: 'sessionKey', ellipsis: true },
                    { title: t('online.ip'), dataIndex: 'ipAddress' },
                    { title: t('app.device'), dataIndex: 'deviceId', ellipsis: true },
                    {
                      title: t('online.connectedAt'),
                      dataIndex: 'connectedAt',
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                    },
                    {
                      title: t('users.lastSeen'),
                      dataIndex: 'lastSeenAt',
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                    },
                  ]}
                />
              </Card>

              <Card size="small" title={t('users.assignments')} style={{ marginTop: 12 }}>
                <Table
                  size="small"
                  rowKey="id"
                  loading={assignmentsQueries.isLoading}
                  dataSource={assignmentsQueries.data ?? []}
                  locale={{ emptyText: t('users.noAssignments') }}
                  pagination={false}
                  columns={[
                    {
                      title: t('inbounds.tag'),
                      dataIndex: 'inboundTag',
                      render: (tag: string, row) => (
                        <Link to={`/inbounds?highlight=${row.inboundId}`}>{tag}</Link>
                      ),
                    },
                    {
                      title: t('app.status'),
                      dataIndex: 'status',
                      render: (status: string) =>
                        t(`enums.assignmentStatus.${status}`, { defaultValue: status }),
                    },
                    { title: t('app.credential'), dataIndex: 'credentialName' },
                  ]}
                />
              </Card>
            </>
          ) : null}
        </Col>
      </Row>

      <QrModal open={qrOpen} value={subUrl} onClose={() => setQrOpen(false)} />
    </div>
  );
}
