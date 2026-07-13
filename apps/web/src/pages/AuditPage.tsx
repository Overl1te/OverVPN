import { Card, DatePicker, Form, Input, Select, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listAuditLogs } from '@/api/audit';
import { PageHeader } from '@/components/PageHeader';
import dayjs from 'dayjs';

export function AuditPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [action, setAction] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<'SUCCESS' | 'FAILURE' | undefined>();
  const [range, setRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const query = useQuery({
    queryKey: [
      'audit',
      page,
      pageSize,
      action,
      outcome,
      range?.[0]?.toISOString(),
      range?.[1]?.toISOString(),
    ],
    queryFn: () =>
      listAuditLogs({
        page,
        pageSize,
        action: action as never,
        outcome,
        from: range?.[0]?.toISOString(),
        to: range?.[1]?.toISOString(),
      }),
  });

  return (
    <div>
      <PageHeader title={t('audit.title')} />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Form layout="inline" style={{ rowGap: 8 }}>
          <Form.Item label={t('audit.action')}>
            <Input
              allowClear
              style={{ width: 220 }}
              value={action}
              onChange={(e) => {
                setAction(e.target.value || undefined);
                setPage(1);
              }}
            />
          </Form.Item>
          <Form.Item label={t('audit.outcome')}>
            <Select
              allowClear
              style={{ width: 120 }}
              value={outcome}
              onChange={(value) => {
                setOutcome(value);
                setPage(1);
              }}
              options={[
                { value: 'SUCCESS', label: t('enums.auditOutcome.SUCCESS') },
                { value: 'FAILURE', label: t('enums.auditOutcome.FAILURE') },
              ]}
            />
          </Form.Item>
          <Form.Item label={t('audit.from')}>
            <DatePicker.RangePicker
              showTime
              value={range ?? undefined}
              onChange={(values) => {
                setRange(values);
                setPage(1);
              }}
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
          {
            title: t('app.createdAt'),
            dataIndex: 'createdAt',
            width: 160,
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
          },
          { title: t('audit.action'), dataIndex: 'action', render: (action: string) => t(`enums.auditAction.${action}`, { defaultValue: action }) },
          {
            title: t('audit.outcome'),
            dataIndex: 'outcome',
            render: (v: string) => (
              <Tag color={v === 'SUCCESS' ? 'green' : 'red'}>
                {t(`enums.auditOutcome.${v}`, { defaultValue: v })}
              </Tag>
            ),
          },
          { title: t('audit.actor'), dataIndex: 'actorUsername' },
          {
            title: t('audit.resource'),
            render: (_, row) =>
              row.resourceType ? `${row.resourceType}:${row.resourceId ?? ''}` : '—',
          },
          { title: t('audit.ip'), dataIndex: 'ipAddress' },
          {
            title: t('audit.details'),
            dataIndex: 'details',
            ellipsis: true,
            render: (value: unknown) => (value ? JSON.stringify(value).slice(0, 120) : '—'),
          },
        ]}
      />
    </div>
  );
}
