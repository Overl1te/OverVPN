import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Descriptions,
  Dropdown,
  Form,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DownOutlined, QrcodeOutlined } from '@ant-design/icons';
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
import { listAssignments, listInbounds, revealAssignmentLink } from '@/api/inbounds';
import { getSettings } from '@/api/settings';
import { PageHeader } from '@/components/PageHeader';
import { UserStatusTag } from '@/components/StatusTag';
import { CopyButton } from '@/components/CopyButton';
import { QrModal } from '@/components/QrModal';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import {
  buildSubscriptionClientLinks,
  buildSubscriptionUrl,
  formatBytes,
  formatBytesPerSecond,
  formatDuration,
  remainingBytes,
  sumByteCounts,
  usagePercent,
} from '@/utils/format';

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canMutate } = useAuth();
  const { message: messageApi, modal } = AntApp.useApp();
  const [form] = Form.useForm();
  const onError = useApiErrorHandler();
  const onFormError = useApiErrorHandler(form);
  const [qrOpen, setQrOpen] = useState(false);
  const [mtproxyQr, setMtproxyQr] = useState<string | null>(null);
  const [usageRange, setUsageRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(29, 'day').startOf('day'),
    dayjs().startOf('day'),
  ]);
  const selectedPlanId = Form.useWatch('planId', form);

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
            .map((item) => ({
              ...item,
              inboundTag: inbound.tag,
              inboundId: inbound.id,
              inboundProtocol: inbound.protocol,
            }));
        }),
      );
      return results.flat();
    },
  });

  const mtproxyAssignments = useMemo(
    () =>
      (assignmentsQueries.data ?? []).filter(
        (row) => row.inboundProtocol === 'MTPROXY' && row.status === 'ACTIVE',
      ),
    [assignmentsQueries.data],
  );

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

  const activePlans = useMemo(
    () => (plansQuery.data?.items ?? []).filter((plan) => plan.status === 'ACTIVE'),
    [plansQuery.data],
  );

  const selectedPlan = useMemo(
    () => (plansQuery.data?.items ?? []).find((plan) => plan.id === selectedPlanId),
    [plansQuery.data, selectedPlanId],
  );

  const selectedPlanHasInbounds = (selectedPlan?.inboundIds.length ?? 0) > 0;

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
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
      if (isNew) {
        navigate(`/users/${user.id}`, { replace: true });
      }
    },
    onError: onFormError,
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
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  const profileForm = (
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
      >
        <Select
          options={planOptions}
          placeholder={t('users.plan')}
          notFoundContent={
            activePlans.length === 0 ? (
              <Typography.Text type="secondary">
                {t('users.noActivePlans')} <Link to="/plans">{t('nav.plans')}</Link>
              </Typography.Text>
            ) : undefined
          }
        />
      </Form.Item>

      {isNew && activePlans.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('users.noActivePlans')}
          action={
            <Link to="/plans">
              <Button size="small">{t('nav.plans')}</Button>
            </Link>
          }
        />
      ) : null}

      {isNew && selectedPlanId && !selectedPlanHasInbounds ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('users.planNoInbounds')}
          action={
            <Link to="/plans">
              <Button size="small">{t('nav.plans')}</Button>
            </Link>
          }
        />
      ) : null}

      <Form.Item name="status" label={t('app.status')} rules={[{ required: true }]}>
        <Select
          options={['ACTIVE', 'DISABLED'].map((value) => ({
            value,
            label: t(`enums.userStatus.${value}`),
          }))}
        />
      </Form.Item>

      <MutateOnly>
        <Button
          type="primary"
          htmlType="submit"
          loading={saveMutation.isPending}
          disabled={isNew && (!selectedPlanId || !selectedPlanHasInbounds)}
        >
          {t('app.save')}
        </Button>
      </MutateOnly>
    </Form>
  );

  if (isNew) {
    return (
      <div>
        <PageHeader title={t('users.create')} extra={<Link to="/users">{t('app.back')}</Link>} />
        <Card size="small" style={{ maxWidth: 520 }}>
          {profileForm}
        </Card>
      </div>
    );
  }

  const usedTotal = user ? sumByteCounts(user.usedUploadBytes, user.usedDownloadBytes) : '0';
  const percent = user ? usagePercent(usedTotal, user.dataLimitBytes) : null;
  const remaining = user ? remainingBytes(usedTotal, user.dataLimitBytes) : null;

  return (
    <div>
      <PageHeader
        title={user?.username ?? t('users.detail')}
        extra={
          <Space wrap>
            <Link to="/users">{t('app.back')}</Link>
            {user ? <UserStatusTag status={user.status} reason={user.statusReason} /> : null}
            {user?.needsApply ? <Tag color="orange">{t('users.needsApply')}</Tag> : null}
            {subUrl ? (
              <CopyButton
                value={subUrl}
                label={t('users.copySubscription')}
                size="middle"
                type="primary"
              />
            ) : null}
            <Button
              size="middle"
              icon={<QrcodeOutlined />}
              disabled={!subUrl}
              onClick={() => setQrOpen(true)}
            >
              {t('app.showQr')}
            </Button>
            <MutateOnly>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'rotate',
                      label: t('app.rotateSub'),
                      onClick: () => {
                        modal.confirm({
                          title: t('users.confirmRotateOne'),
                          onOk: () => rotateMutation.mutateAsync(),
                        });
                      },
                    },
                    {
                      key: 'reset',
                      label: t('app.resetTraffic'),
                      onClick: () => {
                        modal.confirm({
                          title: t('users.confirmResetOne'),
                          onOk: () => resetMutation.mutateAsync(),
                        });
                      },
                    },
                  ],
                }}
              >
                <Button size="middle">
                  {t('users.moreActions')} <DownOutlined />
                </Button>
              </Dropdown>
            </MutateOnly>
          </Space>
        }
      />

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={10}>
          <Card size="small" title={t('users.subscription')}>
            {subUrl ? (
              <Typography.Paragraph
                copyable={{ text: subUrl }}
                style={{ wordBreak: 'break-all', marginBottom: 12, fontSize: 15 }}
              >
                {subUrl}
              </Typography.Paragraph>
            ) : (
              <Typography.Paragraph type="secondary">
                {t('users.subscriptionLoading')}
              </Typography.Paragraph>
            )}

            {formatUrls || clientLinks.length > 0 ? (
              <Tabs
                size="small"
                items={[
                  ...(formatUrls
                    ? [
                        {
                          key: 'formats',
                          label: t('users.subscriptionFormats'),
                          children: (
                            <Space wrap>
                              <CopyButton value={formatUrls.links} label={t('users.formatLinks')} />
                              <CopyButton value={formatUrls.clash} label={t('users.formatClash')} />
                              <CopyButton
                                value={formatUrls.singBox}
                                label={t('users.formatSingBox')}
                              />
                            </Space>
                          ),
                        },
                      ]
                    : []),
                  ...(clientLinks.length > 0
                    ? [
                        {
                          key: 'clients',
                          label: (
                            <Tooltip title={t('users.clientLinksHint')}>
                              <span>{t('users.clientLinks')}</span>
                            </Tooltip>
                          ),
                          children: (
                            <Space wrap>
                              {clientLinks.map((link) => (
                                <CopyButton
                                  key={link.id}
                                  value={link.href}
                                  label={t(`users.clientLink.${link.id}`)}
                                />
                              ))}
                            </Space>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
          </Card>

          <Card size="small" title={t('users.profile')} style={{ marginTop: 12 }}>
            {profileForm}
          </Card>

          {user ? (
            <Card size="small" title={t('users.limits')} style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary">{t('users.quota')}</Typography.Text>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                  {formatBytes(usedTotal)}
                  <Typography.Text type="secondary" style={{ fontSize: 14, fontWeight: 400 }}>
                    {' / '}
                    {user.dataLimitBytes ? formatBytes(user.dataLimitBytes) : t('app.unlimited')}
                  </Typography.Text>
                </div>
                {percent != null ? (
                  <Progress
                    percent={percent}
                    size="small"
                    status={percent >= 100 ? 'exception' : percent >= 90 ? 'active' : 'normal'}
                    style={{ marginTop: 8, marginBottom: 0 }}
                  />
                ) : null}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('users.usageSplit', {
                    upload: formatBytes(user.usedUploadBytes),
                    download: formatBytes(user.usedDownloadBytes),
                  })}
                </Typography.Text>
              </div>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label={t('users.remaining')}>
                  {remaining != null ? formatBytes(remaining) : t('app.unlimited')}
                </Descriptions.Item>
                <Descriptions.Item label={t('users.expireAt')}>
                  {user.expireAt ? dayjs(user.expireAt).format('YYYY-MM-DD HH:mm') : '—'}
                </Descriptions.Item>
                <Descriptions.Item label={t('users.deviceLimit')}>
                  {user.deviceLimit ?? t('app.unlimited')}
                </Descriptions.Item>
                <Descriptions.Item label={t('users.speedLimit')}>
                  {user.speedLimitBps
                    ? formatBytesPerSecond(user.speedLimitBps)
                    : t('app.unlimited')}
                </Descriptions.Item>
              </Descriptions>
              <Collapse
                ghost
                style={{ marginTop: 4 }}
                items={[
                  {
                    key: 'details',
                    label: t('users.quotaDetails'),
                    children: (
                      <Descriptions size="small" column={1}>
                        <Descriptions.Item label={t('users.resetStrategy')}>
                          {t(`enums.resetStrategy.${user.resetStrategy}`, {
                            defaultValue: user.resetStrategy,
                          })}
                        </Descriptions.Item>
                        <Descriptions.Item label={t('users.nextResetAt')}>
                          {user.nextResetAt
                            ? dayjs(user.nextResetAt).format('YYYY-MM-DD HH:mm')
                            : '—'}
                        </Descriptions.Item>
                        <Descriptions.Item label={t('users.trafficResetAt')}>
                          {user.trafficResetAt
                            ? dayjs(user.trafficResetAt).format('YYYY-MM-DD HH:mm')
                            : '—'}
                        </Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </Col>

        <Col xs={24} lg={14}>
          <Card size="small">
            <Tabs
              items={[
                {
                  key: 'usage',
                  label: t('users.tabUsage'),
                  children: (
                    <>
                      <div style={{ marginBottom: 12, textAlign: 'right' }}>
                        <DatePicker.RangePicker
                          size="small"
                          value={usageRange}
                          onChange={(values) => {
                            if (values?.[0] && values[1]) {
                              setUsageRange([values[0], values[1]]);
                            }
                          }}
                        />
                      </div>
                      {usageQuery.data ? (
                        <>
                          <Typography.Text
                            type="secondary"
                            style={{ display: 'block', marginBottom: 8 }}
                          >
                            {t('users.periodUsage', {
                              total: formatBytes(usageQuery.data.periodTotalBytes),
                              upload: formatBytes(usageQuery.data.periodUploadBytes),
                              download: formatBytes(usageQuery.data.periodDownloadBytes),
                            })}
                          </Typography.Text>
                          <Line
                            data={chartData}
                            xField="day"
                            yField="value"
                            seriesField="type"
                            height={220}
                            theme={{ type: 'classicDark' }}
                            axis={{
                              y: {
                                labelFormatter: (v: string | number) => formatBytes(Number(v)),
                              },
                            }}
                          />
                        </>
                      ) : (
                        <Spin />
                      )}
                    </>
                  ),
                },
                {
                  key: 'devices',
                  label: t('users.tabDevices'),
                  children: identitiesQuery.data ? (
                    <>
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
                            online: identitiesQuery.data.devices.filter((row) => row.online).length,
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
                      <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                        {t('users.devices')}
                      </Typography.Text>
                      <Table
                        size="small"
                        rowKey="key"
                        pagination={false}
                        style={{ marginBottom: 16 }}
                        dataSource={identitiesQuery.data.devices}
                        locale={{ emptyText: '—' }}
                        columns={[
                          {
                            title: t('app.device'),
                            dataIndex: 'deviceId',
                            ellipsis: true,
                            render: (v: string | null, row) => v || row.key,
                          },
                          {
                            title: t('online.ip'),
                            dataIndex: 'ipAddress',
                            width: 130,
                          },
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
                            title: t('users.lastSeen'),
                            dataIndex: 'lastSeenAt',
                            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                          },
                        ]}
                      />
                      <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                        {t('users.ips')}
                      </Typography.Text>
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
                  ) : (
                    <Spin />
                  ),
                },
                {
                  key: 'sessions',
                  label: t('users.tabSessions'),
                  children: (
                    <>
                      {id ? (
                        <div style={{ marginBottom: 8, textAlign: 'right' }}>
                          <Link to={`/online?userId=${id}&state=all`}>
                            {t('users.viewAllSessions')}
                          </Link>
                        </div>
                      ) : null}
                      <Table
                        size="small"
                        rowKey="id"
                        pagination={false}
                        scroll={{ x: true }}
                        dataSource={sessionsQuery.data ?? []}
                        columns={[
                          {
                            title: t('online.inbound'),
                            dataIndex: 'inboundTag',
                            width: 120,
                          },
                          { title: t('online.ip'), dataIndex: 'ipAddress', width: 120 },
                          {
                            title: t('app.device'),
                            dataIndex: 'deviceId',
                            ellipsis: true,
                            width: 140,
                          },
                          {
                            title: t('online.connectedAt'),
                            dataIndex: 'connectedAt',
                            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                            width: 140,
                          },
                          {
                            title: t('users.duration'),
                            key: 'duration',
                            width: 90,
                            render: (_, row) =>
                              formatDuration(row.connectedAt, row.disconnectedAt ?? row.lastSeenAt),
                          },
                          {
                            title: t('online.disconnectedAt'),
                            dataIndex: 'disconnectedAt',
                            width: 140,
                            render: (v: string | null) =>
                              v ? dayjs(v).format('YYYY-MM-DD HH:mm') : t('online.active'),
                          },
                          {
                            title: t('users.usage'),
                            key: 'traffic',
                            width: 140,
                            render: (_, row) =>
                              row.uploadBytes != null || row.downloadBytes != null
                                ? `${formatBytes(row.uploadBytes)} ↑ / ${formatBytes(row.downloadBytes)} ↓`
                                : '—',
                          },
                        ]}
                      />
                    </>
                  ),
                },
                {
                  key: 'assignments',
                  label: t('users.tabAssignments'),
                  children: (
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
                          title: t('inbounds.protocol'),
                          dataIndex: 'inboundProtocol',
                          render: (protocol: string) =>
                            t(`enums.protocol.${protocol}`, { defaultValue: protocol }),
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
                  ),
                },
                ...(mtproxyAssignments.length > 0
                  ? [
                      {
                        key: 'mtproxy',
                        label: t('users.tabMtproxy'),
                        children: (
                          <Table
                            size="small"
                            rowKey="id"
                            pagination={false}
                            dataSource={mtproxyAssignments}
                            columns={[
                              {
                                title: t('inbounds.tag'),
                                dataIndex: 'inboundTag',
                              },
                              {
                                title: t('users.mtproxyActions'),
                                key: 'actions',
                                render: (_: unknown, row: (typeof mtproxyAssignments)[number]) => (
                                  <Space wrap>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        void revealAssignmentLink(row.inboundId, row.id)
                                          .then((link) => {
                                            void navigator.clipboard.writeText(link.uri);
                                            void messageApi.success(t('users.mtproxyCopied'));
                                          })
                                          .catch(onError);
                                      }}
                                    >
                                      {t('users.mtproxyCopy')}
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        void revealAssignmentLink(row.inboundId, row.id)
                                          .then((link) => setMtproxyQr(link.uri))
                                          .catch(onError);
                                      }}
                                    >
                                      {t('users.mtproxyQr')}
                                    </Button>
                                  </Space>
                                ),
                              },
                            ]}
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </Col>
      </Row>

      <QrModal open={qrOpen} value={subUrl} onClose={() => setQrOpen(false)} />
      <QrModal
        open={mtproxyQr != null}
        value={mtproxyQr ?? ''}
        onClose={() => setMtproxyQr(null)}
      />
    </div>
  );
}
