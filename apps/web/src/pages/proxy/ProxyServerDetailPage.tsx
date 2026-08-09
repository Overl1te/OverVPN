import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CORE_ENGINES,
  DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
  INBOUND_PROTOCOLS,
  type CoreEngine,
  type InboundProtocol,
} from '@overvpn/shared/constants';
import type { ProxyInstallCommandResponse, ProxyServerWizard } from '@overvpn/shared/schemas';
import {
  applyProxyServerWizard,
  createProxyInstallCommand,
  getProxyServer,
} from '@/api/proxy-servers';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { PageHeader } from '@/components/PageHeader';
import { ProxyServerStatusTag } from '@/components/StatusTag';
import { useApiErrorHandler } from '@/hooks/useApiError';
import dayjs from 'dayjs';

export function ProxyServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();
  const [wizardForm] = Form.useForm<ProxyServerWizard>();
  const [install, setInstall] = useState<ProxyInstallCommandResponse | null>(null);

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
    wizardForm.setFieldsValue({
      publicHost: proxy.publicHost ?? '',
      agentBaseUrl: proxy.agentBaseUrl ?? undefined,
      enabledEngines: proxy.enabledEngines.length > 0 ? proxy.enabledEngines : ['SING_BOX'],
      enabledProtocols: proxy.enabledProtocols.length > 0 ? proxy.enabledProtocols : ['HYSTERIA2'],
      heartbeatIntervalSec: proxy.heartbeatIntervalSec || DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
    });
  }, [proxy, wizardForm]);

  const engineOptions = useMemo(
    () =>
      CORE_ENGINES.map((value) => ({
        value,
        label: t(`enums.coreEngine.${value}`),
      })),
    [t],
  );

  const protocolOptions = useMemo(
    () =>
      INBOUND_PROTOCOLS.map((value) => ({
        value,
        label: t(`enums.protocol.${value}`, {
          defaultValue: t(`enums.inboundProtocol.${value}`, { defaultValue: value }),
        }),
      })),
    [t],
  );

  const wizardMutation = useMutation({
    mutationFn: (body: ProxyServerWizard) => applyProxyServerWizard(id!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });
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
        extra={<Link to="/proxy">{t('app.back')}</Link>}
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label={t('proxy.publicHost')}>
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
          form={wizardForm}
          layout="vertical"
          onFinish={(values) => {
            const body: ProxyServerWizard = {
              publicHost: values.publicHost.trim(),
              enabledEngines: values.enabledEngines,
              enabledProtocols: values.enabledProtocols,
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
            label={t('proxy.publicHost')}
            rules={[{ required: true, message: t('proxy.publicHostRequired') }]}
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
          <Form.Item
            name="enabledEngines"
            label={t('proxy.enabledEngines')}
            rules={[{ required: true, message: t('proxy.enginesRequired') }]}
          >
            <Select mode="multiple" options={engineOptions} />
          </Form.Item>
          <Form.Item
            name="enabledProtocols"
            label={t('proxy.enabledProtocols')}
            rules={[{ required: true, message: t('proxy.protocolsRequired') }]}
          >
            <Select mode="multiple" options={protocolOptions} />
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
