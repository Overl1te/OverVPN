import { App as AntApp, Button, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PROTOCOL_ENGINE_MAP } from '@overvpn/shared';
import type { InboundProtocol } from '@overvpn/shared/constants';
import type { InboundResult } from '@overvpn/shared/schemas';
import {
  addAssignment,
  deleteInbound,
  disableInbound,
  enableInbound,
  listAssignments,
  listInbounds,
  removeAssignment,
  revealAssignmentLink,
  rotateAssignmentCredential,
} from '@/api/inbounds';
import { listProxyServers } from '@/api/proxy-servers';
import { listUsers } from '@/api/users';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { TOUR_ASSIST_EVENT, type TourAssistDetail } from '@/hooks/usePanelTour';
import { notifyCoreApply } from '@/utils/notifyCoreApply';
import { InboundEditor } from './InboundEditor';

function AssignmentsPanel({ inboundId }: { inboundId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const { message: messageApi } = AntApp.useApp();
  const { canMutate } = useAuth();
  const [userId, setUserId] = useState<string | undefined>();
  const [userSearch, setUserSearch] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['assignments', inboundId],
    queryFn: () => listAssignments(inboundId, { page: 1, pageSize: 100 }),
  });

  const usersQuery = useQuery({
    queryKey: ['users', 'assign-options', userSearch],
    queryFn: () =>
      listUsers({
        page: 1,
        pageSize: 50,
        search: userSearch || undefined,
        status: 'ACTIVE',
      }),
    enabled: canMutate,
  });

  const userOptions = useMemo(() => {
    const assigned = new Set((query.data?.items ?? []).map((item) => item.userId));
    return (usersQuery.data?.items ?? [])
      .filter((user) => !assigned.has(user.id))
      .map((user) => ({
        value: user.id,
        label: `${user.username} (${user.identity})`,
      }));
  }, [query.data?.items, usersQuery.data?.items]);

  const addMutation = useMutation({
    mutationFn: () => addAssignment(inboundId, { userId: userId! }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assignments', inboundId] });
      setUserId(undefined);
      notifyCoreApply(result.apply, { t, messageApi, navigate });
    },
    onError: onError,
  });

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => removeAssignment(inboundId, assignmentId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assignments', inboundId] });
      notifyCoreApply(result.apply, { t, messageApi, navigate });
    },
    onError: onError,
  });

  const rotateMutation = useMutation({
    mutationFn: (assignmentId: string) => rotateAssignmentCredential(inboundId, assignmentId, {}),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assignments', inboundId] });
      notifyCoreApply(result.apply, { t, messageApi, navigate });
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
        <Space style={{ marginBottom: 8 }} wrap>
          <Select
            showSearch
            allowClear
            placeholder={t('inbounds.selectUser')}
            value={userId}
            onChange={setUserId}
            onSearch={setUserSearch}
            filterOption={false}
            options={userOptions}
            loading={usersQuery.isLoading}
            style={{ width: 320 }}
            notFoundContent={usersQuery.isFetching ? t('app.loading') : t('app.none')}
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const { message: messageApi } = AntApp.useApp();
  const { admin, canMutate } = useAuth();
  const isOwner = admin?.role === 'OWNER';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [proxyServerId, setProxyServerId] = useState<string | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<InboundResult | null>(null);

  useEffect(() => {
    const onAssist = (event: Event) => {
      const detail = (event as CustomEvent<TourAssistDetail>).detail;
      if (detail?.action !== 'create-inbound' || !canMutate) {
        return;
      }
      setEditing(null);
      setEditorOpen(true);
    };
    window.addEventListener(TOUR_ASSIST_EVENT, onAssist);
    return () => window.removeEventListener(TOUR_ASSIST_EVENT, onAssist);
  }, [canMutate]);

  const proxyServersQuery = useQuery({
    queryKey: ['proxy-servers', 'options'],
    queryFn: () => listProxyServers({ page: 1, pageSize: 100, sortBy: 'name', sortOrder: 'asc' }),
  });

  const proxyNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const server of proxyServersQuery.data?.items ?? []) {
      map.set(server.id, server.name);
    }
    return map;
  }, [proxyServersQuery.data]);

  const proxyFilterOptions = useMemo(
    () =>
      (proxyServersQuery.data?.items ?? []).map((server) => ({
        value: server.id,
        label: server.name,
      })),
    [proxyServersQuery.data],
  );

  const query = useQuery({
    queryKey: ['inbounds', page, pageSize, proxyServerId],
    queryFn: () =>
      listInbounds({
        page,
        pageSize,
        proxyServerId,
      }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? enableInbound(id) : disableInbound(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      notifyCoreApply(result.apply, { t, messageApi, navigate });
    },
    onError: onError,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInbound,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
      notifyCoreApply(result.apply, { t, messageApi, navigate });
    },
    onError: onError,
  });

  return (
    <div>
      <PageHeader
        title={<span data-tour="page-inbounds">{t('inbounds.title')}</span>}
        extra={
          <MutateOnly>
            <Button
              type="primary"
              data-tour="create-inbound"
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

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder={t('inbounds.filterProxyServer')}
          style={{ width: 260 }}
          value={proxyServerId}
          options={proxyFilterOptions}
          loading={proxyServersQuery.isLoading}
          onChange={(value: string | undefined) => {
            setPage(1);
            setProxyServerId(value);
          }}
        />
      </Space>

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
            title: t('inbounds.proxyServer'),
            dataIndex: 'proxyServerId',
            render: (value: string) => proxyNameById.get(value) ?? value.slice(0, 8),
          },
          {
            title: t('inbounds.protocol'),
            dataIndex: 'protocol',
            render: (protocol: InboundProtocol) => (
              <Space size={4} wrap>
                <span>
                  {t(`enums.protocol.${protocol}`, {
                    defaultValue: t(`enums.inboundProtocol.${protocol}`, {
                      defaultValue: protocol,
                    }),
                  })}
                </span>
                <Tag style={{ marginInlineEnd: 0 }}>
                  {t(`enums.coreEngine.${PROTOCOL_ENGINE_MAP[protocol]}`)}
                </Tag>
              </Space>
            ),
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
                {isOwner ? (
                  <Popconfirm
                    title={t('inbounds.confirmDelete')}
                    onConfirm={() => deleteMutation.mutate(row.id)}
                  >
                    <Button size="small" danger loading={deleteMutation.isPending}>
                      {t('app.delete')}
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
