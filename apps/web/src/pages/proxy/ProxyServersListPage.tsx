import { Button, Input, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PROXY_SERVER_STATUSES, type ProxyServerStatus } from '@overvpn/shared/constants';
import type { ProxyServerSummary } from '@overvpn/shared/schemas';
import {
  applyProxyConfig,
  deleteProxyServer,
  disableProxyServer,
  enableProxyServer,
  listProxyServers,
} from '@/api/proxy-servers';
import {
  formatLoadPercent,
  ProxyHeartbeatEngines,
  proxyLoadFromRow,
} from '@/components/ProxyHeartbeat';
import { MutateOnly } from '@/components/MutateOnly';
import { PageHeader } from '@/components/PageHeader';
import { ProxyServerStatusTag } from '@/components/StatusTag';
import { useApiErrorHandler } from '@/hooks/useApiError';
import dayjs from 'dayjs';

export function ProxyServersListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProxyServerStatus | undefined>();

  const query = useQuery({
    queryKey: ['proxy-servers', page, pageSize, search, status],
    queryFn: () =>
      listProxyServers({
        page,
        pageSize,
        search: search || undefined,
        status,
      }),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });
  };

  const enableMutation = useMutation({
    mutationFn: enableProxyServer,
    onSuccess: () => {
      invalidate();
      void message.success(t('proxy.enabledOk'));
    },
    onError,
  });

  const disableMutation = useMutation({
    mutationFn: disableProxyServer,
    onSuccess: () => {
      invalidate();
      void message.success(t('proxy.disabledOk'));
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProxyServer,
    onSuccess: () => {
      invalidate();
      void message.success(t('proxy.deleted'));
    },
    onError,
  });

  const applyMutation = useMutation({
    mutationFn: (proxyId: string) =>
      applyProxyConfig(proxyId, { reason: t('config.defaultApplyReason') }),
    onSuccess: () => {
      invalidate();
      void message.success(t('coreApply.succeeded'));
    },
    onError,
  });

  const statusOptions = useMemo(
    () =>
      PROXY_SERVER_STATUSES.map((value) => ({
        value,
        label: t(`enums.proxyServerStatus.${value}`),
      })),
    [t],
  );

  const actionBusy =
    enableMutation.isPending ||
    disableMutation.isPending ||
    deleteMutation.isPending ||
    applyMutation.isPending;

  return (
    <div>
      <PageHeader
        title={t('proxy.title')}
        extra={
          <MutateOnly>
            <Button type="primary" onClick={() => navigate('/proxy/new')}>
              {t('proxy.create')}
            </Button>
          </MutateOnly>
        }
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder={t('app.search')}
          style={{ width: 240 }}
          onSearch={(value) => {
            setPage(1);
            setSearch(value.trim());
          }}
        />
        <Select
          allowClear
          placeholder={t('app.status')}
          style={{ width: 180 }}
          value={status}
          options={statusOptions}
          onChange={(value: ProxyServerStatus | undefined) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: query.data?.pagination.total ?? 0,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
          showTotal: (total) => t('app.paginationTotal', { total }),
        }}
        columns={[
          {
            title: t('app.name'),
            dataIndex: 'name',
            render: (name: string, row: ProxyServerSummary) => (
              <Space>
                <Link to={`/proxy/${row.id}`}>{name}</Link>
                {row.isLocal ? <Tag>{t('proxy.local')}</Tag> : null}
              </Space>
            ),
          },
          {
            title: t('app.status'),
            dataIndex: 'status',
            render: (value: ProxyServerStatus) => <ProxyServerStatusTag status={value} />,
          },
          {
            title: t('proxy.publicHost'),
            dataIndex: 'publicHost',
            render: (value: string | null) => value || '—',
          },
          {
            title: t('proxy.lastSeenAt'),
            dataIndex: 'lastSeenAt',
            render: (value: string | null) =>
              value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—',
          },
          {
            title: t('proxy.loadCpu'),
            render: (_: unknown, row: ProxyServerSummary) =>
              formatLoadPercent(proxyLoadFromRow(row)?.cpuPercent),
          },
          {
            title: t('proxy.loadMemory'),
            render: (_: unknown, row: ProxyServerSummary) =>
              formatLoadPercent(proxyLoadFromRow(row)?.memoryPercent),
          },
          {
            title: t('proxy.enginesRunning'),
            render: (_: unknown, row: ProxyServerSummary) => (
              <ProxyHeartbeatEngines
                enabledEngines={row.enabledEngines}
                heartbeat={row.lastHeartbeat}
              />
            ),
          },
          {
            title: t('proxy.pendingApplyCol'),
            dataIndex: 'pendingApplyCount',
            render: (count: number) =>
              count > 0 ? <Tag color="orange">{count}</Tag> : <span>—</span>,
          },
          {
            title: t('app.actions'),
            render: (_, row) => (
              <Space wrap size={4}>
                <Link to={`/proxy/${row.id}`}>
                  <Button size="small">{t('app.edit')}</Button>
                </Link>
                <MutateOnly>
                  {row.pendingApplyCount > 0 ? (
                    <Popconfirm
                      title={t('config.confirmApply')}
                      onConfirm={() => applyMutation.mutate(row.id)}
                    >
                      <Button size="small" type="primary" disabled={actionBusy}>
                        {t('app.apply')}
                      </Button>
                    </Popconfirm>
                  ) : null}
                  {row.status === 'DISABLED' ? (
                    <Button
                      size="small"
                      disabled={actionBusy}
                      onClick={() => enableMutation.mutate(row.id)}
                    >
                      {t('proxy.enable')}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      disabled={actionBusy}
                      onClick={() => disableMutation.mutate(row.id)}
                    >
                      {t('proxy.disable')}
                    </Button>
                  )}
                  {!row.isLocal ? (
                    <Popconfirm
                      title={t('proxy.deleteConfirmTitle')}
                      description={t('proxy.deleteConfirm', { name: row.name })}
                      onConfirm={() => deleteMutation.mutate(row.id)}
                    >
                      <Button size="small" danger disabled={actionBusy}>
                        {t('app.delete')}
                      </Button>
                    </Popconfirm>
                  ) : null}
                </MutateOnly>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}
