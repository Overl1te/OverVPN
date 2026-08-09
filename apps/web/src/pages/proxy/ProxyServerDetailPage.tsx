import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
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
  applyProxyConfig,
  applyProxyServerWizard,
  createProxyInstallCommand,
  deleteProxyServer,
  disableProxyServer,
  enableProxyServer,
  getProxyServer,
  listProxyConfigApplies,
  previewProxyConfig,
} from '@/api/proxy-servers';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { PageHeader } from '@/components/PageHeader';
import {
  formatLoadNetwork,
  formatLoadPercent,
  ProxyHeartbeatEngines,
} from '@/components/ProxyHeartbeat';
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
  const [applyReason, setApplyReason] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  const query = useQuery({
    queryKey: ['proxy-servers', id],
    queryFn: () => getProxyServer(id!),
    enabled: !!id,
    refetchInterval: 15_000,
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
    void queryClient.invalidateQueries({ queryKey: ['proxy-config', id] });
  };

  const previewQuery = useQuery({
    queryKey: ['proxy-config', id, 'preview'],
    queryFn: () => previewProxyConfig(id!),
    enabled: !!id,
  });

  const historyQuery = useQuery({
    queryKey: ['proxy-config', id, 'apply', historyPage],
    queryFn: () => listProxyConfigApplies(id!, { page: historyPage, pageSize: 25 }),
    enabled: !!id,
  });

  const reasonText = applyReason ?? t('config.defaultApplyReason');

  const applyConfigMutation = useMutation({
    mutationFn: () => applyProxyConfig(id!, { reason: reasonText }),
    onSuccess: () => {
      invalidate();
      void message.success(t('coreApply.succeeded'));
    },
    onError,
  });

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

      <Card size="small" title={t('proxy.hostAndCores')} style={{ marginBottom: 12 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Statistic
              title={t('proxy.loadCpu')}
              value={formatLoadPercent(proxy.lastHeartbeat?.load?.cpuPercent)}
            />
            {proxy.lastHeartbeat?.load?.cpuPercent !== undefined ? (
              <Progress
                percent={Math.min(100, proxy.lastHeartbeat.load.cpuPercent)}
                size="small"
                showInfo={false}
                strokeColor="#14b8a6"
              />
            ) : null}
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title={t('proxy.loadMemory')}
              value={formatLoadPercent(proxy.lastHeartbeat?.load?.memoryPercent)}
            />
            {proxy.lastHeartbeat?.load?.memoryPercent !== undefined ? (
              <Progress
                percent={Math.min(100, proxy.lastHeartbeat.load.memoryPercent)}
                size="small"
                showInfo={false}
                strokeColor="#22d3ee"
              />
            ) : null}
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title={t('proxy.loadNetwork')}
              value={formatLoadNetwork(proxy.lastHeartbeat?.load ?? null)}
              valueStyle={{ fontSize: 16 }}
            />
          </Col>
        </Row>
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            {t('proxy.enginesRunning')}
            {proxy.lastHeartbeat?.at
              ? ` · ${t('proxy.heartbeatAt')}: ${dayjs(proxy.lastHeartbeat.at).format('YYYY-MM-DD HH:mm:ss')}`
              : null}
          </Typography.Text>
          <ProxyHeartbeatEngines
            enabledEngines={proxy.enabledEngines}
            heartbeat={proxy.lastHeartbeat}
          />
        </div>
      </Card>

      <Card
        size="small"
        title={t('proxy.configTitle')}
        style={{ marginBottom: 12 }}
        extra={
          <Button onClick={() => void previewQuery.refetch()} loading={previewQuery.isFetching}>
            {t('app.refresh')}
          </Button>
        }
        loading={previewQuery.isLoading}
      >
        <Typography.Paragraph type="secondary">{t('proxy.configHint')}</Typography.Paragraph>
        {proxy.pendingApplyCount > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={t('proxy.pendingApply', { count: proxy.pendingApplyCount })}
          />
        ) : null}
        {previewQuery.data ? (
          <>
            <Space wrap style={{ marginBottom: 8 }}>
              <Tag color={previewQuery.data.valid ? 'green' : 'red'}>
                {previewQuery.data.valid ? t('config.valid') : t('config.invalid')}
              </Tag>
              <Typography.Text code>
                {t('config.hash')}: {previewQuery.data.hash}
              </Typography.Text>
              {previewQuery.data.previousHash ? (
                <Typography.Text code>
                  {t('config.previousHash')}: {previewQuery.data.previousHash}
                </Typography.Text>
              ) : null}
            </Space>
            {previewQuery.data.validationError ? (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 8 }}
                message={t('config.validationError')}
                description={previewQuery.data.validationError}
              />
            ) : null}
            <Typography.Title level={5}>{t('config.diff')}</Typography.Title>
            <pre className="code-block">{previewQuery.data.diff || '—'}</pre>
          </>
        ) : null}

        <MutateOnly hint>
          <Form layout="vertical" style={{ marginTop: 12 }}>
            <Form.Item label={t('config.applyReason')} required>
              <Input.TextArea
                rows={2}
                value={reasonText}
                onChange={(e) => setApplyReason(e.target.value)}
              />
            </Form.Item>
            <Popconfirm
              title={t('config.confirmApply')}
              onConfirm={() => applyConfigMutation.mutate()}
              disabled={!previewQuery.data?.valid || reasonText.trim().length < 3}
            >
              <Button
                type="primary"
                loading={applyConfigMutation.isPending}
                disabled={!previewQuery.data?.valid || reasonText.trim().length < 3}
              >
                {t('app.apply')}
              </Button>
            </Popconfirm>
          </Form>
        </MutateOnly>

        <Typography.Title level={5} style={{ marginTop: 16 }}>
          {t('config.history')}
        </Typography.Title>
        <Table
          size="small"
          rowKey="id"
          loading={historyQuery.isLoading}
          dataSource={historyQuery.data?.items ?? []}
          pagination={{
            current: historyPage,
            pageSize: 25,
            total: historyQuery.data?.pagination.total ?? 0,
            onChange: setHistoryPage,
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
