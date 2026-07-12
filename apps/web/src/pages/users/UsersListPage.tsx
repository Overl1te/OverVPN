import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { UserStatus } from '@overvpn/shared/constants';
import { bulkUserAction, listUsers } from '@/api/users';
import { listPlans } from '@/api/plans';
import { PageHeader } from '@/components/PageHeader';
import { UserStatusTag } from '@/components/StatusTag';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { formatBytes } from '@/utils/format';
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

  const planOptions = useMemo(
    () =>
      (plansQuery.data?.items ?? []).map((plan) => ({
        value: plan.id,
        label: plan.name,
      })),
    [plansQuery.data],
  );

  const bulkMutation = useMutation({
    mutationFn: bulkUserAction,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setSelectedRowKeys([]);
    },
    onError: onError,
  });

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
            <Popconfirm
              title={t('users.confirmDisable')}
              onConfirm={() => runBulk('disable', t('users.confirmDisable'))}
            >
              <Button size="small">{t('app.disable')}</Button>
            </Popconfirm>
            <Popconfirm
              title={t('users.confirmEnable')}
              onConfirm={() => runBulk('enable', t('users.confirmEnable'))}
            >
              <Button size="small">{t('app.enable')}</Button>
            </Popconfirm>
            <Popconfirm
              title={t('users.confirmResetTraffic')}
              onConfirm={() => runBulk('reset-traffic', t('users.confirmResetTraffic'))}
            >
              <Button size="small">{t('app.resetTraffic')}</Button>
            </Popconfirm>
            <Button size="small" onClick={() => setExtendOpen(true)}>
              {t('app.extend')}
            </Button>
            <Button size="small" onClick={() => setPlanOpen(true)}>
              {t('app.setPlan')}
            </Button>
            <Popconfirm
              title={t('users.confirmRotateSub')}
              onConfirm={() => runBulk('rotate-sub', t('users.confirmRotateSub'))}
            >
              <Button size="small">{t('app.rotateSub')}</Button>
            </Popconfirm>
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
            render: (_, row) =>
              `${formatBytes(row.usedUploadBytes)} ↑ / ${formatBytes(row.usedDownloadBytes)} ↓`,
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
