import {
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Form,
  Input,
  InputNumber,
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
import type { UserResult } from '@overvpn/shared/schemas';
import {
  createUser,
  getUser,
  getUserSessions,
  getUserUsage,
  resetUserTraffic,
  rotateUserSub,
  updateUser,
} from '@/api/users';
import { listPlans } from '@/api/plans';
import { addAssignment, listAssignments, listInbounds, removeAssignment } from '@/api/inbounds';
import { getSettings } from '@/api/settings';
import { PageHeader } from '@/components/PageHeader';
import { UserStatusTag } from '@/components/StatusTag';
import { CopyButton } from '@/components/CopyButton';
import { QrModal } from '@/components/QrModal';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { buildSubscriptionClientLinks, buildSubscriptionUrl, formatBytes } from '@/utils/format';

function userHasAdvancedValues(user: UserResult): boolean {
  return (
    user.identity !== user.username ||
    user.status !== 'ACTIVE' ||
    user.expireAt !== null ||
    user.dataLimitBytes !== null ||
    user.resetStrategy !== 'NO_RESET' ||
    user.deviceLimit !== null ||
    user.ipLimit !== null ||
    user.speedLimitBps !== null ||
    user.tags.length > 0 ||
    (user.note?.length ?? 0) > 0
  );
}

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  const plansQuery = useQuery({
    queryKey: ['plans', 'all'],
    queryFn: () => listPlans({ page: 1, pageSize: 100 }),
  });

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', 'all'],
    queryFn: () => listInbounds({ page: 1, pageSize: 100 }),
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
      (plansQuery.data?.items ?? []).map((plan) => ({
        value: plan.id,
        label: plan.name,
      })),
    [plansQuery.data],
  );

  const inboundOptions = useMemo(
    () =>
      (inboundsQuery.data?.items ?? []).map((inbound) => ({
        value: inbound.id,
        label: inbound.tag,
      })),
    [inboundsQuery.data],
  );

  const hasInbounds = inboundOptions.length > 0;

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const inboundIds = (values.inboundIds as string[] | undefined) ?? [];
      const payload = {
        username: values.username as string,
        identity: values.identity as string | undefined,
        status: values.status as string | undefined,
        note: (values.note as string | null) ?? null,
        tags: values.tags as string[] | undefined,
        planId: (values.planId as string | null) ?? null,
        expireAt: values.expireAt ? (values.expireAt as dayjs.Dayjs).toISOString() : null,
        dataLimitBytes: values.dataLimitBytes ? String(values.dataLimitBytes) : null,
        resetStrategy: values.resetStrategy as string | undefined,
        deviceLimit: values.deviceLimit as number | null,
        ipLimit: values.ipLimit as number | null,
        speedLimitBps: values.speedLimitBps ? String(values.speedLimitBps) : null,
      };

      const user = isNew
        ? await createUser(payload as never)
        : await updateUser(id!, payload as never);

      const currentAssignments = assignmentsQueries.data ?? [];
      const currentInboundIds = currentAssignments.map((item) => item.inboundId);
      const toAdd = inboundIds.filter((inboundId) => !currentInboundIds.includes(inboundId));
      const toRemove = currentAssignments.filter((item) => !inboundIds.includes(item.inboundId));

      await Promise.all([
        ...toAdd.map((inboundId) => addAssignment(inboundId, { userId: user.id })),
        ...toRemove.map((item) => removeAssignment(item.inboundId, item.id)),
      ]);

      return user;
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
      setAdvancedOpen(userHasAdvancedValues(user));
      form.setFieldsValue({
        username: user.username,
        identity: user.identity,
        status: user.status,
        note: user.note,
        tags: user.tags,
        planId: user.planId,
        expireAt: user.expireAt ? dayjs(user.expireAt) : null,
        dataLimitBytes: user.dataLimitBytes,
        resetStrategy: user.resetStrategy,
        deviceLimit: user.deviceLimit,
        ipLimit: user.ipLimit,
        speedLimitBps: user.speedLimitBps,
      });
    }
  }, [user, form]);

  useEffect(() => {
    if (!isNew && assignmentsQueries.data) {
      form.setFieldValue(
        'inboundIds',
        assignmentsQueries.data.map((item) => item.inboundId),
      );
    }
  }, [assignmentsQueries.data, form, isNew]);

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
              initialValues={{ resetStrategy: 'NO_RESET', tags: [], inboundIds: [] }}
              onFinish={(values) => saveMutation.mutate(values)}
            >
              <Form.Item name="username" label={t('users.username')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>

              <Form.Item
                name="planId"
                label={t('users.plan')}
                extra={<Typography.Text type="secondary">{t('users.planHint')}</Typography.Text>}
              >
                <Select allowClear options={planOptions} />
              </Form.Item>

              <Form.Item
                name="inboundIds"
                label={t('users.inbounds')}
                extra={
                  hasInbounds ? (
                    <Typography.Text type="secondary">{t('users.inboundsHint')}</Typography.Text>
                  ) : null
                }
                rules={
                  hasInbounds
                    ? [{ required: true, type: 'array', min: 1, message: t('users.inboundsHint') }]
                    : []
                }
              >
                <Select
                  mode="multiple"
                  allowClear
                  options={inboundOptions}
                  loading={inboundsQuery.isLoading}
                  placeholder={hasInbounds ? undefined : t('users.noAssignments')}
                />
              </Form.Item>

              <Collapse
                style={{ marginBottom: 16 }}
                activeKey={advancedOpen ? ['advanced'] : []}
                onChange={(keys) => setAdvancedOpen(keys.includes('advanced'))}
                items={[
                  {
                    key: 'advanced',
                    label: t('users.advanced'),
                    children: (
                      <>
                        <Form.Item name="identity" label={t('users.identity')}>
                          <Input />
                        </Form.Item>
                        <Form.Item name="status" label={t('app.status')}>
                          <Select
                            options={['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'].map((value) => ({
                              value,
                              label: t(`enums.userStatus.${value}`),
                            }))}
                          />
                        </Form.Item>
                        <Form.Item name="expireAt" label={t('users.expireAt')}>
                          <DatePicker showTime style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="dataLimitBytes" label={t('users.limit')}>
                          <Input placeholder={t('app.unlimited')} />
                        </Form.Item>
                        <Form.Item name="resetStrategy" label={t('users.resetStrategy')}>
                          <Select
                            options={['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'].map((value) => ({
                              value,
                              label: t(`enums.resetStrategy.${value}`),
                            }))}
                          />
                        </Form.Item>
                        <Form.Item name="deviceLimit" label={t('users.deviceLimit')}>
                          <InputNumber min={1} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="ipLimit" label={t('users.ipLimit')}>
                          <InputNumber min={1} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="speedLimitBps" label={t('users.speedLimit')}>
                          <Input />
                        </Form.Item>
                        <Form.Item name="tags" label={t('users.tags')}>
                          <Select mode="tags" tokenSeparators={[',']} />
                        </Form.Item>
                        <Form.Item name="note" label={t('users.note')}>
                          <Input.TextArea rows={3} />
                        </Form.Item>
                      </>
                    ),
                  },
                ]}
              />

              <MutateOnly>
                <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                  {t('app.save')}
                </Button>
              </MutateOnly>
            </Form>
          </Card>

          {!isNew && user ? (
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
                  <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 6 }}>
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

              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                {t('users.usage')}: {formatBytes(user.usedUploadBytes)} ↑ /{' '}
                {formatBytes(user.usedDownloadBytes)} ↓
              </div>
            </Card>
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
