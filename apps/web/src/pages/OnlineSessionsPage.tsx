import { Card, Form, Input, Select, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listOnlineSessions } from '@/api/online-sessions';
import { PageHeader } from '@/components/PageHeader';
import { formatBytes } from '@/utils/format';
import dayjs from 'dayjs';

export function OnlineSessionsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [userId, setUserId] = useState<string | undefined>(
    () => searchParams.get('userId') || undefined,
  );
  const [username, setUsername] = useState<string | undefined>();
  const [inboundTag, setInboundTag] = useState<string | undefined>();
  const [ip, setIp] = useState<string | undefined>();
  const [state, setState] = useState<'active' | 'history' | 'all'>(() => {
    const value = searchParams.get('state');
    return value === 'history' || value === 'all' || value === 'active' ? value : 'active';
  });

  useEffect(() => {
    const nextUserId = searchParams.get('userId') || undefined;
    const nextState = searchParams.get('state');
    setUserId(nextUserId);
    if (nextState === 'history' || nextState === 'all' || nextState === 'active') {
      setState(nextState);
    }
  }, [searchParams]);

  const query = useQuery({
    queryKey: ['online-sessions', page, pageSize, userId, username, inboundTag, ip, state],
    queryFn: () =>
      listOnlineSessions({
        page,
        pageSize,
        userId,
        username,
        inboundTag,
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
              style={{ width: 160 }}
              placeholder={t('online.usernamePlaceholder')}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value || undefined);
                setPage(1);
              }}
            />
          </Form.Item>
          <Form.Item label={t('online.inbound')}>
            <Input
              allowClear
              style={{ width: 160 }}
              placeholder={t('online.inboundTagPlaceholder')}
              value={inboundTag}
              onChange={(e) => {
                setInboundTag(e.target.value || undefined);
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
        scroll={{ x: true }}
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
          {
            title: t('online.user'),
            dataIndex: 'username',
            render: (usernameValue: string, row) => (
              <Link to={`/users/${row.userId}`}>{usernameValue}</Link>
            ),
          },
          { title: t('online.inbound'), dataIndex: 'inboundTag' },
          { title: t('online.ip'), dataIndex: 'ipAddress' },
          { title: t('online.device'), dataIndex: 'deviceId', ellipsis: true },
          {
            title: t('online.traffic'),
            key: 'traffic',
            render: (_, row) =>
              row.uploadBytes != null || row.downloadBytes != null
                ? `${formatBytes(row.uploadBytes)} ↑ / ${formatBytes(row.downloadBytes)} ↓`
                : '—',
          },
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
