import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PROXY_SERVER_STATUSES, type ProxyServerStatus } from '@overvpn/shared/constants';
import type { CreateProxyServer, ProxyServerSummary } from '@overvpn/shared/schemas';
import { createProxyServer, listProxyServers } from '@/api/proxy-servers';
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
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<CreateProxyServer>();

  const query = useQuery({
    queryKey: ['proxy-servers', page, pageSize, search, status],
    queryFn: () =>
      listProxyServers({
        page,
        pageSize,
        search: search || undefined,
        status,
      }),
  });

  const createMutation = useMutation({
    mutationFn: createProxyServer,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });
      setCreateOpen(false);
      form.resetFields();
      navigate(`/proxy/${created.id}`);
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

  return (
    <div>
      <PageHeader
        title={t('proxy.title')}
        extra={
          <MutateOnly>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
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
            title: t('app.actions'),
            render: (_, row) => (
              <Link to={`/proxy/${row.id}`}>
                <Button size="small">{t('app.edit')}</Button>
              </Link>
            ),
          },
        ]}
      />

      <Modal
        title={t('proxy.create')}
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ isLocal: false }}
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item
            name="name"
            label={t('app.name')}
            rules={[{ required: true, message: t('proxy.nameRequired') }]}
          >
            <Input autoComplete="off" maxLength={100} />
          </Form.Item>
          <Form.Item name="note" label={t('proxy.note')}>
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
          <Form.Item name="isLocal" label={t('proxy.isLocal')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
