import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CORE_ENGINES,
  DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
  INBOUND_PROTOCOLS,
  PROTOCOL_ENGINE_MAP,
  type CoreEngine,
  type InboundProtocol,
} from '@overvpn/shared/constants';
import type { ProxyInstallCommandResponse, ProxyServerWizard } from '@overvpn/shared/schemas';
import {
  applyProxyServerWizard,
  createProxyInstallCommand,
  deleteProxyServer,
  disableProxyServer,
  enableProxyServer,
  getProxyServer,
} from '@/api/proxy-servers';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { PageHeader } from '@/components/PageHeader';
import { ProxyServerStatusTag } from '@/components/StatusTag';
import { useApiErrorHandler } from '@/hooks/useApiError';
import dayjs from 'dayjs';

function protocolsForEngine(engine: CoreEngine): InboundProtocol[] {
  return INBOUND_PROTOCOLS.filter((protocol) => PROTOCOL_ENGINE_MAP[protocol] === engine);
}

export function ProxyServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const [settingsForm] = Form.useForm<ProxyServerWizard>();
  const [install, setInstall] = useState<ProxyInstallCommandResponse | null>(null);
  const [selectedProtocols, setSelectedProtocols] = useState<InboundProtocol[]>([]);

  const query = useQuery({
    queryKey: ['proxy-servers', id],
    queryFn: () => getProxyServer(id!),
    enabled: !!id,
  });

  const proxy = query.data;

  useEffect(() => {
    if (!proxy) {
      return;
    }
    settingsForm.setFieldsValue({
      publicHost: proxy.publicHost ?? '',
      agentBaseUrl: proxy.agentBaseUrl ?? undefined,
      heartbeatIntervalSec: proxy.heartbeatIntervalSec || DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
    });
    setSelectedProtocols(
      proxy.enabledProtocols.length > 0 ? proxy.enabledProtocols : ['HYSTERIA2'],
    );
  }, [proxy, settingsForm]);

  const engineBlocks = useMemo(
    () =>
      CORE_ENGINES.map((engine) => ({
        engine,
        label:
          engine === 'SING_BOX'
            ? t('proxy.coreSingBox')
            : engine === 'XRAY'
              ? t('proxy.coreXray')
              : t('proxy.coreMtproxy'),
        protocols: protocolsForEngine(engine),
      })),
    [t],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });
  };

  const wizardMutation = useMutation({
    mutationFn: (body: ProxyServerWizard) => applyProxyServerWizard(id!, body),
    onSuccess: () => {
      invalidate();
      void message.success(t('app.success'));
    },
    onError,
  });

  const installMutation = useMutation({
    mutationFn: () => createProxyInstallCommand(id!),
    onSuccess: (result) => {
      setInstall(result);
      void message.success(t('proxy.installCommandIssued'));
    },
    onError,
  });

  const enableMutation = useMutation({
    mutationFn: () => enableProxyServer(id!),
    onSuccess: () => {
      invalidate();
      void message.success(t('proxy.enabledOk'));
    },
    onError,
  });

  const disableMutation = useMutation({
    mutationFn: () => disableProxyServer(id!),
    onSuccess: () => {
      invalidate();
      void message.success(t('proxy.disabledOk'));
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProxyServer(id!),
    onSuccess: () => {
      invalidate();
      void message.success(t('proxy.deleted'));
      navigate('/proxy');
    },
    onError,
  });

  const toggleProtocol = (protocol: InboundProtocol, checked: boolean) => {
    setSelectedProtocols((current) => {
      if (checked) {
        return current.includes(protocol) ? current : [...current, protocol];
      }
      return current.filter((item) => item !== protocol);
    });
  };

  if (!id) {
    return <Navigate to="/proxy" replace />;
  }

  if (query.isLoading) {
    return (
      <div className="app-center">
        <Spin size="large" tip={t('app.loading')} />
      </div>
    );
  }

  if (query.isError || !proxy) {
    return (
      <div>
        <PageHeader title={t('proxy.detail')} extra={<Link to="/proxy">{t('app.back')}</Link>} />
        <Alert type="error" showIcon message={t('app.error')} />
      </div>
    );
  }

  const actionBusy =
    enableMutation.isPending ||
    disableMutation.isPending ||
    deleteMutation.isPending ||
    wizardMutation.isPending;

  return (
    <div>
      <PageHeader
        title={
          <Space wrap>
            <span>{proxy.name}</span>
            <ProxyServerStatusTag status={proxy.status} />
            {proxy.isLocal ? <Tag>{t('proxy.local')}</Tag> : null}
          </Space>
        }
        extra={
          <Space wrap>
            <MutateOnly>
              {proxy.status === 'DISABLED' ? (
                <Button disabled={actionBusy} onClick={() => enableMutation.mutate()}>
                  {t('proxy.enable')}
                </Button>
              ) : (
                <Button disabled={actionBusy} onClick={() => disableMutation.mutate()}>
                  {t('proxy.disable')}
                </Button>
              )}
              {!proxy.isLocal ? (
                <Popconfirm
                  title={t('proxy.deleteConfirmTitle')}
                  description={t('proxy.deleteConfirm', { name: proxy.name })}
                  onConfirm={() => deleteMutation.mutate()}
                >
                  <Button danger disabled={actionBusy}>
                    {t('app.delete')}
                  </Button>
                </Popconfirm>
              ) : null}
            </MutateOnly>
            <Link to="/proxy">{t('app.back')}</Link>
          </Space>
        }
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label={t('proxy.clientDomain')}>
            {proxy.publicHost || '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('proxy.agentBaseUrl')}>
            {proxy.agentBaseUrl || '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('proxy.heartbeat')}>
            {proxy.heartbeatIntervalSec}s
          </Descriptions.Item>
          <Descriptions.Item label={t('proxy.lastSeenAt')}>
            {proxy.lastSeenAt ? dayjs(proxy.lastSeenAt).format('YYYY-MM-DD HH:mm:ss') : '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('proxy.enabledEngines')}>
            <Space size={4} wrap>
              {proxy.enabledEngines.length > 0
                ? proxy.enabledEngines.map((engine: CoreEngine) => (
                    <Tag key={engine}>{t(`enums.coreEngine.${engine}`)}</Tag>
                  ))
                : '—'}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={t('proxy.enabledProtocols')}>
            <Space size={4} wrap>
              {proxy.enabledProtocols.length > 0
                ? proxy.enabledProtocols.map((protocol: InboundProtocol) => (
                    <Tag key={protocol}>
                      {t(`enums.protocol.${protocol}`, {
                        defaultValue: t(`enums.inboundProtocol.${protocol}`, {
                          defaultValue: protocol,
                        }),
                      })}
                    </Tag>
                  ))
                : '—'}
            </Space>
          </Descriptions.Item>
          {proxy.lastError ? (
            <Descriptions.Item label={t('app.error')} span={3}>
              <Typography.Text type="danger">{proxy.lastError}</Typography.Text>
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      </Card>

      <Card size="small" title={t('proxy.installCommand')} style={{ marginBottom: 12 }}>
        <Typography.Paragraph type="secondary">
          {t('proxy.installCommandHint')}
        </Typography.Paragraph>
        <MutateOnly hint>
          <Button
            type="primary"
            loading={installMutation.isPending}
            onClick={() => installMutation.mutate()}
            disabled={proxy.isLocal}
          >
            {t('proxy.issueInstallCommand')}
          </Button>
        </MutateOnly>
        {proxy.isLocal ? (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={t('proxy.localNoInstall')}
          />
        ) : null}
        {install ? (
          <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
            <Typography.Text type="secondary">
              {t('proxy.installExpires', {
                at: dayjs(install.expiresAt).format('YYYY-MM-DD HH:mm:ss'),
              })}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t('proxy.panelUrl')}: {install.panelUrl}
            </Typography.Text>
            <Input.TextArea
              value={install.command}
              readOnly
              autoSize={{ minRows: 3, maxRows: 8 }}
            />
            <CopyButton value={install.command} label={t('proxy.copyInstallCommand')} />
          </Space>
        ) : null}
      </Card>

      <Card size="small" title={t('proxy.wizard')}>
        <Typography.Paragraph type="secondary">{t('proxy.wizardHint')}</Typography.Paragraph>
        <Form
          form={settingsForm}
          layout="vertical"
          onFinish={(values) => {
            if (selectedProtocols.length === 0) {
              void message.error(t('proxy.protocolsRequired'));
              return;
            }
            const engines = [
              ...new Set(selectedProtocols.map((protocol) => PROTOCOL_ENGINE_MAP[protocol])),
            ] as CoreEngine[];
            const body: ProxyServerWizard = {
              publicHost: values.publicHost.trim(),
              enabledEngines: engines,
              enabledProtocols: selectedProtocols,
              heartbeatIntervalSec:
                values.heartbeatIntervalSec ?? DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
              settings: {},
              ...(values.agentBaseUrl?.trim() ? { agentBaseUrl: values.agentBaseUrl.trim() } : {}),
            };
            wizardMutation.mutate(body);
          }}
        >
          <Form.Item
            name="publicHost"
            label={t('proxy.clientDomain')}
            extra={t('proxy.clientDomainHint')}
            rules={[{ required: true, message: t('proxy.clientDomainRequired') }]}
          >
            <Input autoComplete="off" maxLength={255} placeholder="vpn.example.com" />
          </Form.Item>
          <Form.Item
            name="agentBaseUrl"
            label={t('proxy.agentBaseUrl')}
            extra={t('proxy.agentBaseUrlHint')}
          >
            <Input autoComplete="off" placeholder="http://10.0.0.2:7700" />
          </Form.Item>
          <Form.Item label={t('proxy.enabledProtocols')} required>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {engineBlocks.map((block) => (
                <Card key={block.engine} size="small" type="inner" title={block.label}>
                  <Space direction="vertical">
                    {block.protocols.map((protocol) => (
                      <Checkbox
                        key={protocol}
                        checked={selectedProtocols.includes(protocol)}
                        onChange={(event) => toggleProtocol(protocol, event.target.checked)}
                      >
                        {t(`enums.protocol.${protocol}`, {
                          defaultValue: t(`enums.inboundProtocol.${protocol}`, {
                            defaultValue: protocol,
                          }),
                        })}
                      </Checkbox>
                    ))}
                  </Space>
                </Card>
              ))}
            </Space>
          </Form.Item>
          <Form.Item
            name="heartbeatIntervalSec"
            label={t('proxy.heartbeat')}
            extra={t('proxy.heartbeatHint')}
          >
            <InputNumber min={5} max={300} style={{ width: 160 }} />
          </Form.Item>
          <MutateOnly hint>
            <Button type="primary" htmlType="submit" loading={wizardMutation.isPending}>
              {t('proxy.applyWizard')}
            </Button>
          </MutateOnly>
        </Form>
      </Card>
    </div>
  );
}
