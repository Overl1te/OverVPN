import {
  buildDefaultInboundSettings,
  type InboundDefaultsContext,
  type InboundListenOverrides,
} from '@overvpn/shared';
import type { InboundProtocol } from '@overvpn/shared/constants';
import type { CreateInbound, InboundResult } from '@overvpn/shared/schemas';
import {
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createInbound, updateInbound } from '@/api/inbounds';
import { getSettings } from '@/api/settings';
import { useApiErrorHandler } from '@/hooks/useApiError';

const PROTOCOLS: InboundProtocol[] = ['HYSTERIA2', 'VLESS_REALITY', 'TROJAN', 'SHADOWSOCKS'];

const VLESS_FLOWS = ['', 'xtls-rprx-vision'] as const;
const REALITY_FINGERPRINTS = [
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  '360',
  'qq',
  'random',
  'randomized',
] as const;
const SHADOWSOCKS_METHODS = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
] as const;

type InboundEditorForm = {
  tag: string;
  protocol: InboundProtocol;
  settings: CreateInbound['settings'];
};

function listenOverrides(settings: InboundEditorForm['settings']): InboundListenOverrides {
  return {
    listenHost: settings.listenHost,
    listenPort: settings.listenPort,
    publicHost: settings.publicHost,
    publicPort: 'publicPort' in settings ? settings.publicPort : undefined,
    enabled: settings.enabled,
  };
}

function syncAcmeTlsHost(
  settings: InboundEditorForm['settings'],
  host: string,
): InboundEditorForm['settings'] {
  if (!('tls' in settings) || settings.tls.mode !== 'ACME') {
    return settings;
  }
  return {
    ...settings,
    tls: {
      ...settings.tls,
      sni: host,
      domains: host ? [host] : [],
    },
  };
}

function Hysteria2Fields() {
  const { t } = useTranslation();
  const form = Form.useFormInstance<InboundEditorForm>();
  const tlsMode = Form.useWatch(['settings', 'tls', 'mode'], form);
  const obfsEnabled = Form.useWatch(['settings', 'obfs'], form) !== null;

  return (
    <>
      <Form.Item name={['settings', 'tls', 'mode']} label={t('inbounds.tlsMode')}>
        <Select
          options={[
            { value: 'ACME', label: t('inbounds.tlsAcme') },
            { value: 'FILES', label: t('inbounds.tlsFiles') },
          ]}
        />
      </Form.Item>
      {tlsMode === 'ACME' ? (
        <>
          <Form.Item
            name={['settings', 'tls', 'sni']}
            label={t('inbounds.tlsSni')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name={['settings', 'tls', 'domains']}
            label={t('inbounds.acmeDomains')}
            rules={[{ required: true }]}
          >
            <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'provider']} label={t('inbounds.acmeProvider')}>
            <Input placeholder="letsencrypt" />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'email']} label={t('inbounds.acmeEmail')}>
            <Input type="email" />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item
            name={['settings', 'tls', 'certificatePath']}
            label={t('inbounds.certificatePath')}
          >
            <Input />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'keyPath']} label={t('inbounds.keyPath')}>
            <Input />
          </Form.Item>
        </>
      )}
      <Space size="large" wrap>
        <Form.Item name={['settings', 'upMbps']} label={t('inbounds.upMbps')}>
          <InputNumber min={1} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name={['settings', 'downMbps']} label={t('inbounds.downMbps')}>
          <InputNumber min={1} style={{ width: 140 }} />
        </Form.Item>
      </Space>
      <Form.Item
        name={['settings', 'ignoreClientBandwidth']}
        label={t('inbounds.ignoreClientBandwidth')}
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <Form.Item label={t('inbounds.obfs')}>
        <Switch
          checked={obfsEnabled}
          onChange={(checked) => {
            form.setFieldValue(
              ['settings', 'obfs'],
              checked ? { type: 'SALAMANDER', password: '' } : null,
            );
          }}
        />
      </Form.Item>
      {obfsEnabled ? (
        <Form.Item name={['settings', 'obfs', 'password']} label={t('inbounds.obfsPassword')}>
          <Input.Password />
        </Form.Item>
      ) : null}
    </>
  );
}

function TrojanFields() {
  const { t } = useTranslation();
  const form = Form.useFormInstance<InboundEditorForm>();
  const tlsMode = Form.useWatch(['settings', 'tls', 'mode'], form);
  const fallbackEnabled = Form.useWatch(['settings', 'fallback'], form) !== null;

  return (
    <>
      <Form.Item name={['settings', 'tls', 'mode']} label={t('inbounds.tlsMode')}>
        <Select
          options={[
            { value: 'ACME', label: t('inbounds.tlsAcme') },
            { value: 'FILES', label: t('inbounds.tlsFiles') },
          ]}
        />
      </Form.Item>
      {tlsMode === 'ACME' ? (
        <>
          <Form.Item
            name={['settings', 'tls', 'sni']}
            label={t('inbounds.tlsSni')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name={['settings', 'tls', 'domains']}
            label={t('inbounds.acmeDomains')}
            rules={[{ required: true }]}
          >
            <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'provider']} label={t('inbounds.acmeProvider')}>
            <Input placeholder="letsencrypt" />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'email']} label={t('inbounds.acmeEmail')}>
            <Input type="email" />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item
            name={['settings', 'tls', 'certificatePath']}
            label={t('inbounds.certificatePath')}
          >
            <Input />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'keyPath']} label={t('inbounds.keyPath')}>
            <Input />
          </Form.Item>
        </>
      )}
      <Form.Item label={t('inbounds.fallback')}>
        <Switch
          checked={fallbackEnabled}
          onChange={(checked) => {
            form.setFieldValue(
              ['settings', 'fallback'],
              checked ? { server: '127.0.0.1', serverPort: 80 } : null,
            );
          }}
        />
      </Form.Item>
      {fallbackEnabled ? (
        <Space size="large" wrap>
          <Form.Item
            name={['settings', 'fallback', 'server']}
            label={t('inbounds.fallbackServer')}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name={['settings', 'fallback', 'serverPort']}
            label={t('inbounds.fallbackPort')}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={65535} style={{ width: 140 }} />
          </Form.Item>
        </Space>
      ) : null}
    </>
  );
}

function VlessRealityFields() {
  const { t } = useTranslation();

  return (
    <>
      <Space size="large" wrap>
        <Form.Item
          name={['settings', 'handshakeServer']}
          label={t('inbounds.realityHandshake')}
          rules={[{ required: true }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name={['settings', 'handshakePort']}
          label={t('inbounds.realityHandshakePort')}
          rules={[{ required: true }]}
        >
          <InputNumber min={1} max={65535} style={{ width: 140 }} />
        </Form.Item>
      </Space>
      <Form.Item
        name={['settings', 'serverNames']}
        label={t('inbounds.realityServerNames')}
        rules={[{ required: true }]}
      >
        <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
      </Form.Item>
      <Form.Item
        name={['settings', 'shortIds']}
        label={t('inbounds.realityShortIds')}
        rules={[{ required: true }]}
      >
        <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
      </Form.Item>
      <Space size="large" wrap>
        <Form.Item name={['settings', 'flow']} label={t('inbounds.realityFlow')}>
          <Select
            options={VLESS_FLOWS.map((value) => ({
              value,
              label: value || t('inbounds.flowNone'),
            }))}
          />
        </Form.Item>
        <Form.Item name={['settings', 'fingerprint']} label={t('inbounds.realityFingerprint')}>
          <Select options={REALITY_FINGERPRINTS.map((value) => ({ value, label: value }))} />
        </Form.Item>
      </Space>
    </>
  );
}

function ShadowsocksFields() {
  const { t } = useTranslation();

  return (
    <>
      <Form.Item name={['settings', 'method']} label={t('inbounds.shadowsocksMethod')}>
        <Select options={SHADOWSOCKS_METHODS.map((value) => ({ value, label: value }))} />
      </Form.Item>
      <Form.Item name={['settings', 'password']} label={t('inbounds.shadowsocksPassword')}>
        <Input.Password placeholder={t('inbounds.secretPresent')} />
      </Form.Item>
    </>
  );
}

function ProtocolFields({ protocol }: { protocol: InboundProtocol | undefined }) {
  switch (protocol) {
    case 'HYSTERIA2':
      return <Hysteria2Fields />;
    case 'TROJAN':
      return <TrojanFields />;
    case 'VLESS_REALITY':
      return <VlessRealityFields />;
    case 'SHADOWSOCKS':
      return <ShadowsocksFields />;
    default:
      return null;
  }
}

export function InboundEditor({
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
  const [form] = Form.useForm<InboundEditorForm>();
  const protocol = Form.useWatch('protocol', form);
  const settings = Form.useWatch('settings', form);
  const [advancedJson, setAdvancedJson] = useState('');
  const [advancedTouched, setAdvancedTouched] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: open && !inbound,
  });

  const defaultsContext = useMemo((): InboundDefaultsContext | null => {
    if (inbound) {
      return {
        publicHost: inbound.settings.publicHost,
      };
    }
    if (!settingsQuery.isSuccess) {
      return null;
    }
    return {
      publicHost: settingsQuery.data.readOnly.vpnPublicHost?.trim() ?? '',
      acmeHttpPort: settingsQuery.data.readOnly.acmeHttpPort,
      acmeTlsPort: settingsQuery.data.readOnly.acmeTlsPort,
    };
  }, [inbound, settingsQuery.data, settingsQuery.isSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (values: InboundEditorForm) => {
      const body = {
        tag: values.tag,
        protocol: values.protocol,
        settings: values.settings,
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
  const isCreateLoading = !inbound && settingsQuery.isLoading;
  const formReady = Boolean(inbound) || settingsQuery.isSuccess;

  useEffect(() => {
    if (!open) {
      setAdvancedJson('');
      setAdvancedTouched(false);
      setAdvancedOpen(false);
      return;
    }
    if (!formReady || !defaultsContext) {
      return;
    }
    const initialSettings =
      inbound?.settings ?? buildDefaultInboundSettings(initialProtocol, defaultsContext);
    form.setFieldsValue({
      tag: inbound?.tag ?? '',
      protocol: initialProtocol,
      settings: initialSettings,
    });
    setAdvancedJson(JSON.stringify(initialSettings, null, 2));
    setAdvancedTouched(false);
  }, [open, formReady, defaultsContext, inbound, initialProtocol, form]);

  useEffect(() => {
    if (!advancedOpen || advancedTouched || !settings) {
      return;
    }
    setAdvancedJson(JSON.stringify(settings, null, 2));
  }, [settings, advancedOpen, advancedTouched]);

  const handleProtocolChange = (value: InboundProtocol) => {
    if (inbound || !defaultsContext) {
      return;
    }
    const current = form.getFieldsValue();
    const nextSettings = buildDefaultInboundSettings(
      value,
      defaultsContext,
      listenOverrides(current.settings),
    );
    form.setFieldsValue({ protocol: value, settings: nextSettings });
    if (!advancedTouched) {
      setAdvancedJson(JSON.stringify(nextSettings, null, 2));
    }
  };

  const handlePublicHostChange = (host: string) => {
    const current = form.getFieldValue('settings') as InboundEditorForm['settings'];
    form.setFieldValue('settings', syncAcmeTlsHost({ ...current, publicHost: host }, host));
  };

  const applyAdvancedJson = () => {
    try {
      const parsed = JSON.parse(advancedJson) as InboundEditorForm['settings'];
      form.setFieldValue('settings', parsed);
      setAdvancedTouched(true);
    } catch {
      form.setFields([
        {
          name: 'settings',
          errors: [t('app.invalidJson')],
        },
      ]);
    }
  };

  return (
    <Drawer
      width={720}
      open={open}
      destroyOnClose
      title={inbound ? t('inbounds.edit') : t('inbounds.create')}
      onClose={onClose}
      extra={
        <Button
          type="primary"
          loading={saveMutation.isPending}
          disabled={isCreateLoading}
          onClick={() => form.submit()}
        >
          {t('app.save')}
        </Button>
      }
    >
      {isCreateLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : null}
      {formReady ? (
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="tag" label={t('inbounds.tag')} rules={[{ required: true }]}>
            <Input disabled={!!inbound} />
          </Form.Item>
          <Form.Item name="protocol" label={t('inbounds.protocol')}>
            <Select
              disabled={!!inbound}
              options={PROTOCOLS.map((value) => ({
                value,
                label: t(`enums.protocol.${value}`),
              }))}
              onChange={handleProtocolChange}
            />
          </Form.Item>

          <Typography.Title level={5}>{t('inbounds.sectionListen')}</Typography.Title>
          <Space size="large" wrap>
            <Form.Item
              name={['settings', 'listenHost']}
              label={t('inbounds.listenHost')}
              rules={[{ required: true }]}
            >
              <Input style={{ width: 220 }} />
            </Form.Item>
            <Form.Item
              name={['settings', 'listenPort']}
              label={t('inbounds.listenPort')}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={65535} style={{ width: 140 }} />
            </Form.Item>
          </Space>

          <Typography.Title level={5}>{t('inbounds.sectionPublic')}</Typography.Title>
          <Space size="large" wrap>
            <Form.Item
              name={['settings', 'publicHost']}
              label={t('inbounds.publicHost')}
              rules={[{ required: true, message: t('inbounds.publicHostRequired') }]}
            >
              <Input
                style={{ width: 280 }}
                onChange={(event) => handlePublicHostChange(event.target.value)}
              />
            </Form.Item>
            <Form.Item name={['settings', 'publicPort']} label={t('inbounds.publicPort')}>
              <InputNumber
                min={1}
                max={65535}
                style={{ width: 140 }}
                placeholder={t('inbounds.sameAsListen')}
              />
            </Form.Item>
          </Space>
          {!defaultsContext?.publicHost && !inbound ? (
            <Typography.Text type="warning">{t('inbounds.publicHostMissingEnv')}</Typography.Text>
          ) : null}

          <Form.Item
            name={['settings', 'enabled']}
            label={t('inbounds.enabled')}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Typography.Title level={5}>{t('inbounds.sectionProtocol')}</Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            {protocol ? t(`enums.protocol.${protocol}`, { defaultValue: protocol }) : '—'} ·{' '}
            {t('inbounds.secretPresent')}
          </Typography.Text>
          <ProtocolFields protocol={protocol} />

          <Collapse
            style={{ marginTop: 16 }}
            activeKey={advancedOpen ? ['advanced'] : []}
            onChange={(keys) => {
              const nextOpen = keys.includes('advanced');
              setAdvancedOpen(nextOpen);
              if (nextOpen && settings) {
                setAdvancedJson(JSON.stringify(settings, null, 2));
              }
            }}
            items={[
              {
                key: 'advanced',
                label: t('inbounds.advanced'),
                children: (
                  <>
                    <Input.TextArea
                      rows={14}
                      value={advancedJson}
                      onChange={(event) => setAdvancedJson(event.target.value)}
                      onBlur={applyAdvancedJson}
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <Button size="small" style={{ marginTop: 8 }} onClick={applyAdvancedJson}>
                      {t('inbounds.applyAdvanced')}
                    </Button>
                  </>
                ),
              },
            ]}
          />
        </Form>
      ) : null}
    </Drawer>
  );
}
