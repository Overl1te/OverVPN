import { useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BackupKind } from '@overvpn/shared/constants';
import type { BackupArtifactResult } from '@overvpn/shared/schemas';
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  listBackups,
  restoreBackup,
} from '@/api/backups';
import { MutateOnly } from '@/components/MutateOnly';
import { PageHeader } from '@/components/PageHeader';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { useAuth } from '@/auth/AuthContext';
import { formatBytes } from '@/utils/format';
import dayjs from 'dayjs';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'default',
  RUNNING: 'processing',
  SUCCEEDED: 'green',
  FAILED: 'red',
  DELETED: 'default',
};

export function BackupsPage() {
  const { t } = useTranslation();
  const { admin } = useAuth();
  const showError = useApiErrorHandler();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<BackupKind>('FULL');
  const [restoreTarget, setRestoreTarget] = useState<BackupArtifactResult | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const listQuery = useQuery({
    queryKey: ['backups'],
    queryFn: () => listBackups({ page: 1, pageSize: 50 }),
  });

  const createMutation = useMutation({
    mutationFn: () => createBackup({ kind }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
      if (result.status === 'SUCCEEDED') {
        message.success(t('backups.createSuccess'));
      } else {
        message.error(result.errorMessage ?? t('backups.createFailed'));
      }
    },
    onError: showError,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreBackup(id, { confirm: true }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
      setRestoreTarget(null);
      setConfirmText('');
      if (result.status === 'SUCCEEDED') {
        message.success(t('backups.restoreSuccess'));
      } else {
        message.error(result.errorMessage ?? t('backups.restoreFailed'));
      }
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBackup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
      message.success(t('app.success'));
    },
    onError: showError,
  });

  const isOwner = admin?.role === 'OWNER';

  return (
    <div>
      <PageHeader
        title={t('backups.title')}
        extra={
          <MutateOnly>
            <Space>
              <Select
                value={kind}
                style={{ width: 180 }}
                onChange={(value: BackupKind) => setKind(value)}
                options={[
                  { value: 'DATABASE', label: t('backups.kindDatabase') },
                  { value: 'CORE_CONFIG', label: t('backups.kindCore') },
                  { value: 'FULL', label: t('backups.kindFull') },
                ]}
              />
              <Button
                type="primary"
                loading={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {t('backups.create')}
              </Button>
            </Space>
          </MutateOnly>
        }
      />

      <Table
        size="small"
        rowKey="id"
        loading={listQuery.isLoading}
        dataSource={listQuery.data?.items ?? []}
        pagination={false}
        columns={[
          {
            title: t('backups.kind'),
            dataIndex: 'kind',
            render: (value: string) => (
              <Tag>{t(`enums.backupKind.${value}`, { defaultValue: value })}</Tag>
            ),
          },
          {
            title: t('app.status'),
            dataIndex: 'status',
            render: (status: string) => (
              <Tag color={STATUS_COLOR[status] ?? 'default'}>
                {t(`enums.backupStatus.${status}`, { defaultValue: status })}
              </Tag>
            ),
          },
          {
            title: t('backups.size'),
            dataIndex: 'sizeBytes',
            render: (value: string | null) => (value ? formatBytes(value) : '—'),
          },
          {
            title: t('backups.encrypted'),
            dataIndex: 'encrypted',
            render: (value: boolean) => (value ? t('app.yes') : t('app.no')),
          },
          {
            title: t('app.createdAt'),
            dataIndex: 'createdAt',
            render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm:ss'),
          },
          {
            title: t('app.actions'),
            key: 'actions',
            render: (_, row) => (
              <Space wrap>
                <MutateOnly>
                  <Button
                    size="small"
                    disabled={row.status === 'DELETED'}
                    onClick={() => {
                      void downloadBackup(row.id).catch(showError);
                    }}
                  >
                    {t('backups.download')}
                  </Button>
                </MutateOnly>
                {isOwner ? (
                  <Button
                    size="small"
                    danger
                    disabled={row.status === 'DELETED' || row.status === 'RUNNING'}
                    onClick={() => {
                      setConfirmText('');
                      setRestoreTarget(row);
                    }}
                  >
                    {t('backups.restore')}
                  </Button>
                ) : null}
                {isOwner ? (
                  <Popconfirm
                    title={t('backups.confirmDelete')}
                    onConfirm={() => deleteMutation.mutate(row.id)}
                  >
                    <Button size="small" disabled={row.status === 'DELETED'}>
                      {t('app.delete')}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={restoreTarget !== null}
        title={t('backups.restoreTitle')}
        okText={t('backups.restore')}
        okButtonProps={{
          danger: true,
          disabled: confirmText !== 'RESTORE',
          loading: restoreMutation.isPending,
        }}
        onCancel={() => {
          setRestoreTarget(null);
          setConfirmText('');
        }}
        onOk={() => {
          if (restoreTarget) {
            restoreMutation.mutate(restoreTarget.id);
          }
        }}
      >
        <p>{t('backups.restoreWarning')}</p>
        <p>
          {t('backups.restoreTypeConfirm')} <code>RESTORE</code>
        </p>
        <Form layout="vertical">
          <Form.Item label={t('backups.confirmLabel')}>
            <Input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
