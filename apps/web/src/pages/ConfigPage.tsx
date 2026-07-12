import { Alert, Button, Card, Form, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyConfig, listApplies, previewConfig } from '@/api/config';
import { PageHeader } from '@/components/PageHeader';
import { MutateOnly } from '@/components/MutateOnly';
import { useApiErrorHandler } from '@/hooks/useApiError';
import dayjs from 'dayjs';

export function ConfigPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const [reason, setReason] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const previewQuery = useQuery({
    queryKey: ['config-preview'],
    queryFn: previewConfig,
  });

  const historyQuery = useQuery({
    queryKey: ['config-apply', page],
    queryFn: () => listApplies({ page, pageSize: 25 }),
  });

  const applyReason = reason ?? t('config.defaultApplyReason');

  const applyMutation = useMutation({
    mutationFn: () => applyConfig({ reason: applyReason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['config-preview'] });
      void queryClient.invalidateQueries({ queryKey: ['config-apply'] });
    },
    onError: onError,
  });

  const preview = previewQuery.data;

  return (
    <div>
      <PageHeader
        title={t('config.title')}
        extra={
          <Button onClick={() => void previewQuery.refetch()} loading={previewQuery.isFetching}>
            {t('app.refresh')}
          </Button>
        }
      />

      <Card size="small" title={t('config.preview')} loading={previewQuery.isLoading}>
        {preview ? (
          <>
            <Space wrap style={{ marginBottom: 8 }}>
              <Tag color={preview.valid ? 'green' : 'red'}>
                {preview.valid ? t('config.valid') : t('config.invalid')}
              </Tag>
              <Typography.Text code>
                {t('config.hash')}: {preview.hash}
              </Typography.Text>
              {preview.previousHash ? (
                <Typography.Text code>
                  {t('config.previousHash')}: {preview.previousHash}
                </Typography.Text>
              ) : null}
            </Space>
            {preview.validationError ? (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 8 }}
                message={t('config.validationError')}
                description={preview.validationError}
              />
            ) : null}
            <Typography.Title level={5}>{t('config.diff')}</Typography.Title>
            <pre className="code-block">{preview.diff || '—'}</pre>
          </>
        ) : null}
      </Card>

      <MutateOnly hint>
        <Card size="small" title={t('config.applyTitle')} style={{ marginTop: 12 }}>
          <Form layout="vertical">
            <Form.Item label={t('config.applyReason')} required>
              <Input.TextArea
                rows={2}
                value={applyReason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Form.Item>
            <Popconfirm
              title={t('config.confirmApply')}
              onConfirm={() => applyMutation.mutate()}
              disabled={!preview?.valid || applyReason.trim().length < 3}
            >
              <Button
                type="primary"
                loading={applyMutation.isPending}
                disabled={!preview?.valid || applyReason.trim().length < 3}
              >
                {t('app.apply')}
              </Button>
            </Popconfirm>
          </Form>
        </Card>
      </MutateOnly>

      <Card size="small" title={t('config.history')} style={{ marginTop: 12 }}>
        <Table
          size="small"
          rowKey="id"
          loading={historyQuery.isLoading}
          dataSource={historyQuery.data?.items ?? []}
          pagination={{
            current: page,
            pageSize: 25,
            total: historyQuery.data?.pagination.total ?? 0,
            onChange: setPage,
          }}
          columns={[
            {
              title: t('app.status'),
              dataIndex: 'status',
              render: (status: string) => (
                <Tag>{t(`enums.coreApplyStatus.${status}`, { defaultValue: status })}</Tag>
              ),
            },
            {
              title: t('config.trigger'),
              dataIndex: 'trigger',
              render: (trigger: string) =>
                t(`enums.coreApplyTrigger.${trigger}`, { defaultValue: trigger }),
            },
            { title: t('config.actor'), dataIndex: 'actorUsername' },
            { title: t('config.applyReason'), dataIndex: 'reason', ellipsis: true },
            {
              title: t('app.createdAt'),
              dataIndex: 'createdAt',
              render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
            {
              title: t('app.error'),
              dataIndex: 'error',
              ellipsis: true,
              render: (v: string | null) => v || '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
