import {
  Button,
  Card,
  Col,
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
import { listInbounds, listAssignments } from '@/api/inbounds';
import { PageHeader } from '@/components/PageHeader';
import { UserStatusTag } from '@/components/StatusTag';
import { CopyButton } from '@/components/CopyButton';
import { QrModal } from '@/components/QrModal';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { buildSubscriptionUrl, formatBytes } from '@/utils/format';

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

  const plansQuery = useQuery({
    queryKey: ['plans', 'all'],
    queryFn: () => listPlans({ page: 1, pageSize: 100 }),
  });

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', 'all'],
    queryFn: () => listInbounds({ page: 1, pageSize: 100 }),
    enabled: !isNew && !!id,
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

  const planOptions = useMemo(
    () =>
      (plansQuery.data?.items ?? []).map((plan) => ({
        value: plan.id,
        label: plan.name,
      })),
    [plansQuery.data],
  );

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
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
      if (isNew) {
        return createUser(payload as never);
      }
      return updateUser(id!, payload as never);
    },
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', user.id] });
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
  const subUrl = user ? buildSubscriptionUrl(user.subToken) : '';

  const chartData =
    usageQuery.data?.series.flatMap((point) => [
      { day: point.day, type: t('app.upload'), value: Number(point.uploadBytes) },
      { day: point.day, type: t('app.download'), value: Number(point.downloadBytes) },
    ]) ?? [];

  useEffect(() => {
    if (user) {
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
          <Card size="small" title={t('users.limits')}>
            <Form
              form={form}
              layout="vertical"
              disabled={!canMutate}
              initialValues={{ resetStrategy: 'NO_RESET', tags: [] }}
              onFinish={(values) => saveMutation.mutate(values)}
            >
              <Form.Item name="username" label={t('users.username')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
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
              <Form.Item name="planId" label={t('users.plan')}>
                <Select allowClear options={planOptions} />
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
              <MutateOnly>
                <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                  {t('app.save')}
                </Button>
              </MutateOnly>
            </Form>
          </Card>

          {!isNew && user ? (
            <Card size="small" title={t('users.subscription')} style={{ marginTop: 12 }}>
              <Typography.Paragraph copyable={{ text: subUrl }} style={{ wordBreak: 'break-all' }}>
                {subUrl}
              </Typography.Paragraph>
              <Space wrap>
                <CopyButton value={subUrl} />
                <Button size="small" onClick={() => setQrOpen(true)}>
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
