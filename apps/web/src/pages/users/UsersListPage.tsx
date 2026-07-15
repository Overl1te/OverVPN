import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { UserStatus } from '@overvpn/shared/constants';
import type { UserResult } from '@overvpn/shared/schemas';
import { bulkUserAction, listUsers, resetUserTraffic, rotateUserSub } from '@/api/users';
import { listPlans } from '@/api/plans';
import { getSettings } from '@/api/settings';
import { PageHeader } from '@/components/PageHeader';
import { UserStatusTag } from '@/components/StatusTag';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { buildSubscriptionUrl, formatBytes, sumByteCounts, usagePercent } from '@/utils/format';
import dayjs from 'dayjs';

export function UsersListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const { canMutate } = useAuth();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | undefined>();
  const [tag, setTag] = useState<string | undefined>();
  const [planId, setPlanId] = useState<string | undefined>();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [extendOpen, setExtendOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [extendDays, setExtendDays] = useState(30);
  const [bulkPlanId, setBulkPlanId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users', page, pageSize, search, status, tag, planId],
    queryFn: () =>
      listUsers({
        page,
        pageSize,
        search: search || undefined,
        status,
        tag,
        planId,
      }),
  });

  const plansQuery = useQuery({
    queryKey: ['plans', 'all'],
    queryFn: () => listPlans({ page: 1, pageSize: 100, status: 'ACTIVE' }),
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const planOptions = useMemo(
    () =>
      (plansQuery.data?.items ?? []).map((plan) => ({
        value: plan.id,
        label: plan.name,
      })),
    [plansQuery.data],
  );

  const subBaseUrl = settingsQuery.data?.subPublicBaseUrl;

  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const bulkMutation = useMutation({
    mutationFn: bulkUserAction,
    onSuccess: () => {
      invalidateUsers();
      setSelectedRowKeys([]);
    },
    onError: onError,
  });

  const rowMutation = useMutation({
    mutationFn: async ({
      action,
      userId,
    }: {
      action: 'disable' | 'enable' | 'rotate-sub' | 'reset-traffic';
      userId: string;
    }) => {
      if (action === 'rotate-sub') {
        return rotateUserSub(userId);
      }
      if (action === 'reset-traffic') {
        return resetUserTraffic(userId);
      }
      return bulkUserAction({ action, userIds: [userId] } as never);
    },
    onSuccess: () => invalidateUsers(),
    onError: onError,
  });

  const copySub = async (user: UserResult) => {
    if (!subBaseUrl) {
      message.warning(t('users.subscriptionLoading'));
      return;
    }
    const url = buildSubscriptionUrl(user.subToken, subBaseUrl);
    try {
      await navigator.clipboard.writeText(url);
      message.success(t('app.copied'));
    } catch {
      message.error(t('app.error'));
    }
  };

  const runBulk = (
    action: 'disable' | 'enable' | 'reset-traffic' | 'rotate-sub',
    confirm: string,
  ) => {
    if (!selectedRowKeys.length) return;
    Modal.confirm({
      title: confirm,
      onOk: () =>
        bulkMutation.mutateAsync({
          action,
          userIds: selectedRowKeys,
        } as never),
    });
  };

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        extra={
          <MutateOnly>
            <Button type="primary" onClick={() => navigate('/users/new')}>
              {t('users.create')}
            </Button>
          </MutateOnly>
        }
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Form layout="inline" style={{ rowGap: 8 }}>
          <Form.Item label={t('app.search')}>
            <Input
              allowClear
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              style={{ width: 180 }}
            />
          </Form.Item>
          <Form.Item label={t('app.status')}>
            <Select
              allowClear
              style={{ width: 140 }}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={['ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED'].map((value) => ({
                value,
                label: t(`enums.userStatus.${value}`),
              }))}
            />
          </Form.Item>
          <Form.Item label={t('users.tag')}>
            <Input
              allowClear
              value={tag}
              onChange={(e) => {
                setTag(e.target.value || undefined);
                setPage(1);
              }}
              style={{ width: 120 }}
            />
          </Form.Item>
          <Form.Item label={t('users.plan')}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 160 }}
              value={planId}
              onChange={(value) => {
                setPlanId(value);
                setPage(1);
              }}
              options={planOptions}
            />
          </Form.Item>
        </Form>
      </Card>

      {canMutate && selectedRowKeys.length > 0 ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Space wrap>
            <span>{t('users.bulkSelected', { count: selectedRowKeys.length })}</span>
            <Button size="small" onClick={() => runBulk('disable', t('users.confirmDisable'))}>
              {t('app.disable')}
            </Button>
            <Button size="small" onClick={() => runBulk('enable', t('users.confirmEnable'))}>
              {t('app.enable')}
            </Button>
            <Button
              size="small"
              onClick={() => runBulk('reset-traffic', t('users.confirmResetTraffic'))}
            >
              {t('app.resetTraffic')}
            </Button>
            <Button size="small" onClick={() => setExtendOpen(true)}>
              {t('app.extend')}
            </Button>
            <Button size="small" onClick={() => setPlanOpen(true)}>
              {t('app.setPlan')}
            </Button>
            <Button size="small" onClick={() => runBulk('rotate-sub', t('users.confirmRotateSub'))}>
              {t('app.rotateSub')}
            </Button>
          </Space>
        </Card>
      ) : null}

      <Table
        size="small"
        rowKey="id"
        loading={usersQuery.isLoading}
        dataSource={usersQuery.data?.items ?? []}
        rowSelection={
          canMutate
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }
            : undefined
        }
        pagination={{
          current: page,
          pageSize,
          total: usersQuery.data?.pagination.total ?? 0,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
          showTotal: (total) => t('app.paginationTotal', { total }),
        }}
        columns={[
          {
            title: t('users.username'),
            dataIndex: 'username',
            render: (value: string, row) => <Link to={`/users/${row.id}`}>{value}</Link>,
          },
          {
            title: t('app.status'),
            dataIndex: 'status',
            render: (status: UserStatus, row) => (
              <UserStatusTag status={status} reason={row.statusReason} />
            ),
          },
          {
            title: t('users.plan'),
            dataIndex: 'planId',
            render: (value: string | null) =>
              planOptions.find((p) => p.value === value)?.label ?? value ?? '—',
          },
          {
            title: t('users.usage'),
            render: (_, row) => {
              const used = sumByteCounts(row.usedUploadBytes, row.usedDownloadBytes);
              const percent = usagePercent(used, row.dataLimitBytes);
              return (
                <div>
                  <div>
                    {t('users.usageOfLimit', {
                      used: formatBytes(used),
                      limit: row.dataLimitBytes
                        ? formatBytes(row.dataLimitBytes)
                        : t('app.unlimited'),
                    })}
                    {percent != null ? (
                      <Typography.Text type="secondary" style={{ marginLeft: 6 }}>
                        {t('users.usagePercent', { percent: percent.toFixed(0) })}
                      </Typography.Text>
                    ) : null}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatBytes(row.usedUploadBytes)} ↑ / {formatBytes(row.usedDownloadBytes)} ↓
                  </Typography.Text>
                </div>
              );
            },
          },
          {
            title: t('users.limit'),
            dataIndex: 'dataLimitBytes',
            render: (value: string | null) => (value ? formatBytes(value) : t('app.unlimited')),
          },
          {
            title: t('users.expireAt'),
            dataIndex: 'expireAt',
            render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD') : '—'),
          },
          {
            title: t('users.tags'),
            dataIndex: 'tags',
            render: (tags: string[]) =>
              tags.map((tag) => (
                <Tag key={tag} style={{ marginBottom: 2 }}>
                  {tag}
                </Tag>
              )),
          },
          {
            title: t('app.actions'),
            render: (_, row: UserResult) => (
              <Space wrap size={4}>
                <Button size="small" onClick={() => void copySub(row)} disabled={!subBaseUrl}>
                  {t('users.copySub')}
                </Button>
                <Button size="small" onClick={() => navigate(`/users/${row.id}`)}>
                  {t('users.openDetail')}
                </Button>
                <MutateOnly>
                  {row.status === 'DISABLED' ? (
                    <Button
                      size="small"
                      loading={rowMutation.isPending}
                      onClick={() => rowMutation.mutate({ action: 'enable', userId: row.id })}
                    >
                      {t('app.enable')}
                    </Button>
                  ) : (
                    <Popconfirm
                      title={t('users.confirmDisable')}
                      onConfirm={() => rowMutation.mutate({ action: 'disable', userId: row.id })}
                    >
                      <Button size="small" loading={rowMutation.isPending}>
                        {t('app.disable')}
                      </Button>
                    </Popconfirm>
                  )}
                  <Popconfirm
                    title={t('users.confirmRotateOne')}
                    onConfirm={() => rowMutation.mutate({ action: 'rotate-sub', userId: row.id })}
                  >
                    <Button size="small" loading={rowMutation.isPending}>
                      {t('app.rotateSub')}
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={t('users.confirmResetOne')}
                    onConfirm={() =>
                      rowMutation.mutate({ action: 'reset-traffic', userId: row.id })
                    }
                  >
                    <Button size="small" loading={rowMutation.isPending}>
                      {t('app.resetTraffic')}
                    </Button>
                  </Popconfirm>
                </MutateOnly>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={extendOpen}
        title={t('app.extend')}
        onCancel={() => setExtendOpen(false)}
        onOk={() =>
          bulkMutation
            .mutateAsync({
              action: 'extend',
              userIds: selectedRowKeys,
              days: extendDays,
            })
            .then(() => setExtendOpen(false))
        }
      >
        <Form.Item label={t('app.days')}>
          <InputNumber
            min={1}
            max={3650}
            value={extendDays}
            onChange={(v) => setExtendDays(v ?? 30)}
          />
        </Form.Item>
      </Modal>

      <Modal
        open={planOpen}
        title={t('app.setPlan')}
        onCancel={() => setPlanOpen(false)}
        onOk={() =>
          bulkMutation
            .mutateAsync({
              action: 'set-plan',
              userIds: selectedRowKeys,
              planId: bulkPlanId,
            })
            .then(() => setPlanOpen(false))
        }
      >
        <Select
          allowClear
          style={{ width: '100%' }}
          placeholder={t('app.none')}
          value={bulkPlanId ?? undefined}
          onChange={(value) => setBulkPlanId(value ?? null)}
          options={planOptions}
        />
      </Modal>
    </div>
  );
}
