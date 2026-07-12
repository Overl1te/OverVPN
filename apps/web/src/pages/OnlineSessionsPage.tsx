import { Card, Form, Input, Select, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listOnlineSessions } from '@/api/online-sessions';
import { PageHeader } from '@/components/PageHeader';
import dayjs from 'dayjs';

export function OnlineSessionsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [userId, setUserId] = useState<string | undefined>();
  const [inboundId, setInboundId] = useState<string | undefined>();
  const [ip, setIp] = useState<string | undefined>();
  const [state, setState] = useState<'active' | 'history' | 'all'>('active');

  const query = useQuery({
    queryKey: ['online-sessions', page, pageSize, userId, inboundId, ip, state],
    queryFn: () =>
      listOnlineSessions({
        page,
        pageSize,
        userId,
        inboundId,
        ip,
        state,
      }),
    refetchInterval: 15_000,
  });

  return (
    <div>
      <PageHeader title={t('online.title')} />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Form layout="inline" style={{ rowGap: 8 }}>
          <Form.Item label={t('online.user')}>
            <Input
              allowClear
              style={{ width: 260 }}
              placeholder={t('online.userIdPlaceholder')}
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value || undefined);
                setPage(1);
              }}
            />
          </Form.Item>
          <Form.Item label={t('online.inbound')}>
            <Input
              allowClear
              style={{ width: 260 }}
              placeholder={t('online.inboundIdPlaceholder')}
              value={inboundId}
              onChange={(e) => {
                setInboundId(e.target.value || undefined);
                setPage(1);
              }}
            />
          </Form.Item>
          <Form.Item label={t('online.ip')}>
            <Input
              allowClear
              style={{ width: 140 }}
              value={ip}
              onChange={(e) => {
                setIp(e.target.value || undefined);
                setPage(1);
              }}
            />
          </Form.Item>
          <Form.Item label={t('online.state')}>
            <Select
              style={{ width: 120 }}
              value={state}
              onChange={(value) => {
                setState(value);
                setPage(1);
              }}
              options={[
                { value: 'active', label: t('online.active') },
                { value: 'history', label: t('online.history') },
                { value: 'all', label: t('online.all') },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

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
        }}
        columns={[
          { title: t('online.user'), dataIndex: 'username' },
          { title: t('online.inbound'), dataIndex: 'inboundTag' },
          { title: t('online.ip'), dataIndex: 'ipAddress' },
          { title: t('online.device'), dataIndex: 'deviceId', ellipsis: true },
          {
            title: t('online.connectedAt'),
            dataIndex: 'connectedAt',
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
          },
          {
            title: t('online.lastSeenAt'),
            dataIndex: 'lastSeenAt',
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
          },
          {
            title: t('online.disconnectedAt'),
            dataIndex: 'disconnectedAt',
            render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '—'),
          },
        ]}
      />
    </div>
  );
}
