import {
  Button,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateInbound, InboundResult } from '@overvpn/shared/schemas';
import type { InboundProtocol } from '@overvpn/shared/constants';
import {
  addAssignment,
  createInbound,
  disableInbound,
  enableInbound,
  listAssignments,
  listInbounds,
  removeAssignment,
  revealAssignmentLink,
  rotateAssignmentCredential,
  updateInbound,
} from '@/api/inbounds';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';

function defaultSettings(protocol: InboundProtocol) {
  const common = {
    listenHost: '0.0.0.0',
    listenPort: 443,
    publicHost: 'vpn.example.com',
    enabled: true,
  };
  switch (protocol) {
    case 'HYSTERIA2':
      return {
        ...common,
        upMbps: null,
        downMbps: null,
        ignoreClientBandwidth: false,
        obfs: null,
        tls: {
          mode: 'ACME',
          sni: 'vpn.example.com',
          alpn: ['h3'],
          domains: ['vpn.example.com'],
          dataDirectory: '/var/lib/sing-box-state/acme',
          provider: 'letsencrypt',
          disableHttpChallenge: false,
          disableTlsAlpnChallenge: false,
          cipherSuites: [],
          curvePreferences: [],
          kernelTx: false,
          kernelRx: false,
          clientInsecure: false,
        },
        masquerade: null,
        bindInterface: null,
        routingMark: null,
        reuseAddr: false,
        netns: null,
        tcpFastOpen: false,
        tcpMultiPath: false,
        disableTcpKeepAlive: false,
        tcpKeepAlive: null,
        tcpKeepAliveInterval: null,
        udpFragment: null,
        udpTimeout: null,
        detour: null,
        brutalDebug: false,
      };
    case 'VLESS_REALITY':
      return {
        ...common,
        handshakeServer: 'www.cloudflare.com',
        handshakePort: 443,
        serverNames: ['www.cloudflare.com'],
        shortIds: [''],
        flow: 'xtls-rprx-vision',
        transport: 'none',
        fingerprint: 'chrome',
      };
    case 'TROJAN':
      return {
        ...common,
        tls: {
          mode: 'ACME',
          sni: 'vpn.example.com',
          alpn: ['h3'],
          domains: ['vpn.example.com'],
          dataDirectory: '/var/lib/sing-box-state/acme',
          provider: 'letsencrypt',
          disableHttpChallenge: false,
          disableTlsAlpnChallenge: false,
          cipherSuites: [],
          curvePreferences: [],
          kernelTx: false,
          kernelRx: false,
          clientInsecure: false,
        },
        fallback: null,
      };
    case 'SHADOWSOCKS':
      return {
        ...common,
        listenPort: 8388,
        method: '2022-blake3-aes-256-gcm',
      };
  }
}

function InboundEditor({
  open,
  inbound,
  onClose,
}: {
  open: boolean;
  inbound: InboundResult | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const [form] = Form.useForm();
  const protocol = Form.useWatch('protocol', form) as InboundProtocol | undefined;

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const body = {
        tag: values.tag as string,
        protocol: values.protocol as InboundProtocol,
        settings: JSON.parse(values.settingsJson as string),
      };
      if (inbound) {
        return updateInbound(inbound.id, body);
      }
      return createInbound(body as CreateInbound);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      onClose();
    },
    onError: onError,
  });

  const initialProtocol = inbound?.protocol ?? 'HYSTERIA2';

  return (
    <Drawer
      width={720}
      open={open}
      destroyOnClose
      title={inbound ? t('inbounds.edit') : t('inbounds.create')}
      onClose={onClose}
      extra={
        <Button type="primary" loading={saveMutation.isPending} onClick={() => form.submit()}>
          {t('app.save')}
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          tag: inbound?.tag ?? '',
          protocol: initialProtocol,
          settingsJson: JSON.stringify(
            inbound?.settings ?? defaultSettings(initialProtocol),
            null,
            2,
          ),
        }}
        onFinish={(values) => saveMutation.mutate(values)}
      >
        <Form.Item name="tag" label={t('inbounds.tag')} rules={[{ required: true }]}>
          <Input disabled={!!inbound} />
        </Form.Item>
        <Form.Item name="protocol" label={t('inbounds.protocol')}>
          <Select
            disabled={!!inbound}
            options={['HYSTERIA2', 'VLESS_REALITY', 'TROJAN', 'SHADOWSOCKS'].map((value) => ({
              value,
              label: t(`enums.protocol.${value}`),
            }))}
            onChange={(value: InboundProtocol) => {
              if (!inbound) {
                form.setFieldValue('settingsJson', JSON.stringify(defaultSettings(value), null, 2));
              }
            }}
          />
        </Form.Item>
        <Typography.Text type="secondary">
          {protocol} · {t('inbounds.secretPresent')}
        </Typography.Text>
        <Form.Item
          name="settingsJson"
          label={t('inbounds.advanced')}
          rules={[
            {
              validator: async (_, value: string) => {
                try {
                  JSON.parse(value);
                } catch {
                  throw new Error(t('app.invalidJson'));
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={18} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

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
            render: (protocol: string) => t(`enums.protocol.${protocol}`, { defaultValue: protocol }),
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
            render: (value: boolean) =>
              value ? <Tag color="orange">{t('app.yes')}</Tag> : '—',
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
