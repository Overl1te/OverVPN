import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Space,
  Steps,
  Switch,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CORE_ENGINES,
  DEFAULT_AGENT_LISTEN_PORT,
  DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
  INBOUND_PROTOCOLS,
  PROTOCOL_ENGINE_MAP,
  type CoreEngine,
  type InboundProtocol,
} from '@overvpn/shared/constants';
import type {
  ProxyDnsCheckResponse,
  ProxyInstallCommandResponse,
  ProxyServerSummary,
} from '@overvpn/shared/schemas';
import {
  applyProxyServerWizard,
  checkProxyDns,
  createProxyInstallCommand,
  createProxyServer,
  getProxyServer,
} from '@/api/proxy-servers';
import { CopyButton } from '@/components/CopyButton';
import { MutateOnly } from '@/components/MutateOnly';
import { PageHeader } from '@/components/PageHeader';
import { ProxyServerStatusTag } from '@/components/StatusTag';
import { useApiErrorHandler } from '@/hooks/useApiError';
import dayjs from 'dayjs';
import { isIP } from '@/utils/net';

type BasicsValues = {
  name: string;
  note?: string;
  isLocal: boolean;
};

type NetworkValues = {
  clientDomain: string;
  serverIp?: string;
};

const VERIFY_TIMEOUT_MS = 120_000;
const VERIFY_POLL_MS = 3_000;

function protocolsForEngine(engine: CoreEngine): InboundProtocol[] {
  return INBOUND_PROTOCOLS.filter((protocol) => PROTOCOL_ENGINE_MAP[protocol] === engine);
}

function buildAgentBaseUrl(isLocal: boolean, serverIp: string | undefined): string | undefined {
  if (isLocal) {
    return `http://agent:${DEFAULT_AGENT_LISTEN_PORT}`;
  }
  const ip = serverIp?.trim();
  if (!ip) {
    return undefined;
  }
  const host = isIP(ip) === 6 ? `[${ip}]` : ip;
  return `http://${host}:${DEFAULT_AGENT_LISTEN_PORT}`;
}

export function ProxyCreateWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const onError = useApiErrorHandler();

  const [step, setStep] = useState(0);
  const [proxyId, setProxyId] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [selectedProtocols, setSelectedProtocols] = useState<InboundProtocol[]>([]);
  const [dnsResult, setDnsResult] = useState<ProxyDnsCheckResponse | null>(null);
  const [install, setInstall] = useState<ProxyInstallCommandResponse | null>(null);
  const [verifyStartedAt, setVerifyStartedAt] = useState<number | null>(null);
  const [verifyTimedOut, setVerifyTimedOut] = useState(false);

  const [basicsForm] = Form.useForm<BasicsValues>();
  const [networkForm] = Form.useForm<NetworkValues>();

  const proxyQuery = useQuery({
    queryKey: ['proxy-servers', proxyId],
    queryFn: () => getProxyServer(proxyId!),
    enabled: !!proxyId && step >= 4,
    refetchInterval: (query) => {
      if (step !== 4 || !verifyStartedAt) {
        return false;
      }
      const data = query.state.data as ProxyServerSummary | undefined;
      if (data?.status === 'ONLINE') {
        return false;
      }
      if (Date.now() - verifyStartedAt > VERIFY_TIMEOUT_MS) {
        return false;
      }
      return VERIFY_POLL_MS;
    },
  });

  useEffect(() => {
    if (step !== 4 || !verifyStartedAt) {
      return;
    }
    if (proxyQuery.data?.status === 'ONLINE') {
      setVerifyTimedOut(false);
      return;
    }
    if (Date.now() - verifyStartedAt > VERIFY_TIMEOUT_MS) {
      setVerifyTimedOut(true);
    }
  }, [step, verifyStartedAt, proxyQuery.data?.status, proxyQuery.dataUpdatedAt]);

  const createMutation = useMutation({
    mutationFn: createProxyServer,
    onError,
  });

  const wizardMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof applyProxyServerWizard>[1];
    }) => applyProxyServerWizard(id, body),
    onError,
  });

  const dnsMutation = useMutation({
    mutationFn: checkProxyDns,
    onError,
  });

  const installMutation = useMutation({
    mutationFn: (id: string) => createProxyInstallCommand(id),
    onError,
  });

  const steps = useMemo(
    () => [
      { title: t('proxy.wizardStepBasics') },
      { title: t('proxy.wizardStepNetwork') },
      { title: t('proxy.wizardStepProtocols') },
      { title: t('proxy.wizardStepInstall') },
      { title: t('proxy.wizardStepVerify') },
    ],
    [t],
  );

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

  const toggleProtocol = (protocol: InboundProtocol, checked: boolean) => {
    setSelectedProtocols((current) => {
      if (checked) {
        return current.includes(protocol) ? current : [...current, protocol];
      }
      return current.filter((item) => item !== protocol);
    });
  };

  const goNextFromBasics = async () => {
    const values = await basicsForm.validateFields();
    setIsLocal(values.isLocal);
    if (!proxyId) {
      const created = await createMutation.mutateAsync({
        name: values.name.trim(),
        note: values.note?.trim() || undefined,
        isLocal: values.isLocal,
      });
      setProxyId(created.id);
      void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });
    }
    setStep(1);
  };

  const goNextFromNetwork = async () => {
    const values = await networkForm.validateFields();
    const domain = values.clientDomain.trim();
    const serverIp = values.serverIp?.trim();
    if (!isLocal) {
      if (!serverIp || isIP(serverIp) === 0) {
        networkForm.setFields([
          {
            name: 'serverIp',
            errors: [t('proxy.serverIpInvalid')],
          },
        ]);
        return;
      }
      const dns = await dnsMutation.mutateAsync({
        domain,
        expectedIp: serverIp,
      });
      setDnsResult(dns);
      if (dns.matchesExpected === false) {
        void message.warning(
          t('proxy.dnsMismatch', {
            addresses: dns.resolvedAddresses.join(', ') || '—',
            expected: serverIp,
          }),
        );
      } else if (dns.warning) {
        void message.warning(t('proxy.dnsFailed', { warning: dns.warning }));
      }
    } else {
      setDnsResult(null);
    }
    setStep(2);
  };

  const goNextFromProtocols = async () => {
    if (!proxyId) {
      return;
    }
    if (selectedProtocols.length === 0) {
      void message.error(t('proxy.protocolsRequired'));
      return;
    }
    const network = networkForm.getFieldsValue();
    const engines = [
      ...new Set(selectedProtocols.map((protocol) => PROTOCOL_ENGINE_MAP[protocol])),
    ] as CoreEngine[];
    const agentBaseUrl = buildAgentBaseUrl(isLocal, network.serverIp);
    await wizardMutation.mutateAsync({
      id: proxyId,
      body: {
        publicHost: network.clientDomain.trim(),
        enabledEngines: engines,
        enabledProtocols: selectedProtocols,
        heartbeatIntervalSec: DEFAULT_PROXY_HEARTBEAT_INTERVAL_SEC,
        settings: {},
        ...(agentBaseUrl ? { agentBaseUrl } : {}),
      },
    });
    void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });

    if (!isLocal) {
      const command = await installMutation.mutateAsync(proxyId);
      setInstall(command);
    } else {
      setInstall(null);
    }
    setStep(3);
  };

  const goNextFromInstall = () => {
    setVerifyStartedAt(Date.now());
    setVerifyTimedOut(false);
    setStep(4);
    void proxyQuery.refetch();
  };

  const retryVerify = () => {
    setVerifyStartedAt(Date.now());
    setVerifyTimedOut(false);
    void proxyQuery.refetch();
  };

  const busy =
    createMutation.isPending ||
    wizardMutation.isPending ||
    dnsMutation.isPending ||
    installMutation.isPending;

  return (
    <div>
      <PageHeader title={t('proxy.wizardTitle')} extra={<Link to="/proxy">{t('app.back')}</Link>} />

      <Card size="small">
        <Steps current={step} items={steps} style={{ marginBottom: 24 }} />

        {step === 0 ? (
          <Form
            form={basicsForm}
            layout="vertical"
            initialValues={{ isLocal: false }}
            onFinish={() => void goNextFromBasics()}
          >
            <Form.Item
              name="name"
              label={t('app.name')}
              rules={[{ required: true, message: t('proxy.nameRequired') }]}
            >
              <Input autoComplete="off" maxLength={100} />
            </Form.Item>
            <Form.Item name="note" label={t('proxy.note')}>
              <Input.TextArea rows={3} maxLength={1000} />
            </Form.Item>
            <Form.Item
              name="isLocal"
              label={t('proxy.isLocal')}
              extra={t('proxy.isLocalHint')}
              valuePropName="checked"
            >
              <Switch
                onChange={(checked) => {
                  setIsLocal(checked);
                  basicsForm.setFieldValue('isLocal', checked);
                }}
              />
            </Form.Item>
            <MutateOnly hint>
              <Button type="primary" htmlType="submit" loading={busy}>
                {t('proxy.wizardNext')}
              </Button>
            </MutateOnly>
          </Form>
        ) : null}

        {step === 1 ? (
          <Form form={networkForm} layout="vertical" onFinish={() => void goNextFromNetwork()}>
            <Form.Item
              name="clientDomain"
              label={t('proxy.clientDomain')}
              extra={t('proxy.clientDomainHint')}
              rules={[{ required: true, message: t('proxy.clientDomainRequired') }]}
            >
              <Input autoComplete="off" maxLength={255} placeholder="vpn.example.com" />
            </Form.Item>
            {!isLocal ? (
              <Form.Item
                name="serverIp"
                label={t('proxy.serverIp')}
                extra={t('proxy.serverIpHint')}
                rules={[{ required: true, message: t('proxy.serverIpRequired') }]}
              >
                <Input autoComplete="off" maxLength={64} placeholder="203.0.113.10" />
              </Form.Item>
            ) : (
              <Alert type="info" showIcon message={t('proxy.localNoInstall')} />
            )}
            {dnsResult ? (
              <Alert
                style={{ marginBottom: 16 }}
                type={
                  dnsResult.matchesExpected === false
                    ? 'warning'
                    : dnsResult.warning
                      ? 'warning'
                      : 'success'
                }
                showIcon
                message={
                  dnsResult.matchesExpected
                    ? t('proxy.dnsOk')
                    : dnsResult.matchesExpected === false
                      ? t('proxy.dnsMismatch', {
                          addresses: dnsResult.resolvedAddresses.join(', ') || '—',
                          expected: networkForm.getFieldValue('serverIp'),
                        })
                      : t('proxy.dnsFailed', {
                          warning: dnsResult.warning ?? 'unknown',
                        })
                }
              />
            ) : null}
            <Space>
              <Button onClick={() => setStep(0)}>{t('proxy.wizardBack')}</Button>
              <MutateOnly hint>
                <Button type="primary" htmlType="submit" loading={busy}>
                  {t('proxy.wizardNext')}
                </Button>
              </MutateOnly>
            </Space>
          </Form>
        ) : null}

        {step === 2 ? (
          <div>
            <Typography.Paragraph type="secondary">
              {t('proxy.protocolsRequired')}
            </Typography.Paragraph>
            <Space direction="vertical" size={16} style={{ width: '100%', marginBottom: 16 }}>
              {engineBlocks.map((block) => (
                <Card key={block.engine} size="small" title={block.label}>
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
            <Space>
              <Button onClick={() => setStep(1)}>{t('proxy.wizardBack')}</Button>
              <MutateOnly hint>
                <Button type="primary" loading={busy} onClick={() => void goNextFromProtocols()}>
                  {t('proxy.wizardNext')}
                </Button>
              </MutateOnly>
            </Space>
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            {isLocal ? (
              <Alert type="info" showIcon message={t('proxy.localNoInstall')} />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Typography.Paragraph type="secondary">
                  {t('proxy.installCommandHint')}
                </Typography.Paragraph>
                {install ? (
                  <>
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
                  </>
                ) : (
                  <Alert type="warning" showIcon message={t('app.error')} />
                )}
              </Space>
            )}
            <Space style={{ marginTop: 16 }}>
              <Button onClick={() => setStep(2)}>{t('proxy.wizardBack')}</Button>
              <Button type="primary" onClick={goNextFromInstall}>
                {t('proxy.wizardNext')}
              </Button>
            </Space>
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {proxyQuery.data ? (
                <Space>
                  <Typography.Text>
                    {t('proxy.verifyStatus', {
                      status: t(`enums.proxyServerStatus.${proxyQuery.data.status}`),
                    })}
                  </Typography.Text>
                  <ProxyServerStatusTag status={proxyQuery.data.status} />
                </Space>
              ) : null}
              {proxyQuery.data?.status === 'ONLINE' ? (
                <Alert type="success" showIcon message={t('proxy.verifyOnline')} />
              ) : verifyTimedOut ? (
                <Alert type="warning" showIcon message={t('proxy.verifyTimeout')} />
              ) : (
                <Alert type="info" showIcon message={t('proxy.verifyWaiting')} />
              )}
              {proxyQuery.data?.lastError ? (
                <Alert type="error" showIcon message={proxyQuery.data.lastError} />
              ) : null}
            </Space>
            <Space style={{ marginTop: 16 }} wrap>
              <Button onClick={() => setStep(3)}>{t('proxy.wizardBack')}</Button>
              <Button onClick={retryVerify} loading={proxyQuery.isFetching}>
                {t('proxy.wizardRetry')}
              </Button>
              {proxyId ? (
                <Button type="default" onClick={() => navigate(`/proxy/${proxyId}`)}>
                  {t('proxy.openDetail')}
                </Button>
              ) : null}
              <Button
                type="primary"
                onClick={() => {
                  void queryClient.invalidateQueries({ queryKey: ['proxy-servers'] });
                  navigate('/proxy');
                }}
              >
                {t('proxy.wizardFinish')}
              </Button>
            </Space>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
