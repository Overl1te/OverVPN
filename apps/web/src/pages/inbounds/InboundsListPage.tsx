import { Button, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InboundResult } from '@overvpn/shared/schemas';
import {
  addAssignment,
  disableInbound,
  enableInbound,
  listAssignments,
  listInbounds,
  removeAssignment,
  revealAssignmentLink,
  rotateAssignmentCredential,
} from '@/api/inbounds';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { InboundEditor } from './InboundEditor';

function AssignmentsPanel({ inboundId }: { inboundId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const { canMutate } = useAuth();
  const [userId, setUserId] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['assignments', inboundId],
    queryFn: () => listAssignments(inboundId, { page: 1, pageSize: 100 }),
  });

  const addMutation = useMutation({
    mutationFn: () => addAssignment(inboundId, { userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assignments', inboundId] });
      setUserId('');
    },
    onError: onError,
  });

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => removeAssignment(inboundId, assignmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assignments', inboundId] });
    },
    onError: onError,
  });

  const rotateMutation = useMutation({
    mutationFn: (assignmentId: string) => rotateAssignmentCredential(inboundId, assignmentId, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assignments', inboundId] });
    },
    onError: onError,
  });

  const revealMutation = useMutation({
    mutationFn: (assignmentId: string) => revealAssignmentLink(inboundId, assignmentId),
    onSuccess: (link, assignmentId) => {
      setRevealed((prev) => ({ ...prev, [assignmentId]: link.uri }));
    },
    onError: onError,
  });

  return (
    <div>
      {canMutate ? (
        <Space style={{ marginBottom: 8 }}>
          <Input
            placeholder={t('inbounds.userId')}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            style={{ width: 280 }}
          />
          <Button
            type="primary"
            size="small"
            disabled={!userId}
            loading={addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            {t('inbounds.addAssignment')}
          </Button>
        </Space>
      ) : null}
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={query.data?.items ?? []}
        columns={[
          { title: t('users.username'), dataIndex: 'userUsername' },
          { title: t('users.identity'), dataIndex: 'userIdentity' },
          {
            title: t('app.status'),
            dataIndex: 'status',
            render: (status: string) =>
              t(`enums.assignmentStatus.${status}`, { defaultValue: status }),
          },
          {
            title: t('inbounds.credential'),
            render: (_, row) => (row.credentialPresent ? t('app.present') : t('app.missing')),
          },
          {
            title: t('app.actions'),
            render: (_, row) => (
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => revealMutation.mutate(row.id)}
                  loading={revealMutation.isPending}
                >
                  {t('app.reveal')}
                </Button>
                {revealed[row.id] ? (
                  <>
                    <CopyButton value={revealed[row.id]!} />
                    <Typography.Text code style={{ maxWidth: 200 }} ellipsis>
                      {revealed[row.id]}
                    </Typography.Text>
                  </>
                ) : null}
                {canMutate ? (
                  <>
                    <Popconfirm
                      title={t('inbounds.confirmRotateCred')}
                      onConfirm={() => rotateMutation.mutate(row.id)}
                    >
                      <Button size="small">{t('app.rotate')}</Button>
                    </Popconfirm>
                    <Popconfirm
                      title={t('inbounds.confirmRemoveAssignment')}
                      onConfirm={() => removeMutation.mutate(row.id)}
                    >
                      <Button size="small" danger>
                        {t('app.delete')}
                      </Button>
                    </Popconfirm>
                  </>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}

export function InboundsListPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const { canMutate } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<InboundResult | null>(null);

  const query = useQuery({
    queryKey: ['inbounds', page, pageSize],
    queryFn: () => listInbounds({ page, pageSize }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? enableInbound(id) : disableInbound(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    },
    onError: onError,
  });

  return (
    <div>
      <PageHeader
        title={t('inbounds.title')}
        extra={
          <MutateOnly>
            <Button
              type="primary"
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              {t('inbounds.create')}
            </Button>
          </MutateOnly>
        }
      />

      <Table
        size="small"
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data?.items ?? []}
        expandable={{
          expandedRowRender: (row) => <AssignmentsPanel inboundId={row.id} />,
          rowExpandable: () => true,
        }}
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
          { title: t('inbounds.tag'), dataIndex: 'tag' },
          {
            title: t('inbounds.protocol'),
            dataIndex: 'protocol',
            render: (protocol: string) =>
              t(`enums.protocol.${protocol}`, { defaultValue: protocol }),
          },
          {
            title: t('inbounds.listen'),
            render: (_, row) => `${row.settings.listenHost}:${row.settings.listenPort}`,
          },
          {
            title: t('inbounds.public'),
            render: (_, row) => `${row.settings.publicHost}:${row.settings.publicPort}`,
          },
          {
            title: t('app.status'),
            render: (_, row) => (
              <Tag color={row.settings.enabled ? 'green' : 'default'}>
                {row.settings.enabled ? t('app.enabled') : t('app.disabled')}
              </Tag>
            ),
          },
          {
            title: t('inbounds.needsApply'),
            dataIndex: 'needsApply',
            render: (value: boolean) => (value ? <Tag color="orange">{t('app.yes')}</Tag> : '—'),
          },
          {
            title: t('inbounds.assignments'),
            dataIndex: 'assignmentCount',
          },
          {
            title: t('app.actions'),
            render: (_, row) => (
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(row);
                    setEditorOpen(true);
                  }}
                >
                  {t('app.edit')}
                </Button>
                {canMutate ? (
                  <Popconfirm
                    title={
                      row.settings.enabled
                        ? t('inbounds.confirmDisable')
                        : t('inbounds.confirmEnable')
                    }
                    onConfirm={() =>
                      toggleMutation.mutate({
                        id: row.id,
                        enabled: !row.settings.enabled,
                      })
                    }
                  >
                    <Button size="small">
                      {row.settings.enabled ? t('app.disable') : t('app.enable')}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <InboundEditor
        open={editorOpen}
        inbound={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
