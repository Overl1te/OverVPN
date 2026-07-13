import {
  buildDefaultInboundSettings,
  defaultAcmeEmail,
  type InboundDefaultsContext,
  type InboundListenOverrides,
} from '@overvpn/shared';
import type { InboundProtocol } from '@overvpn/shared/constants';
import type { CreateInbound, InboundResult } from '@overvpn/shared/schemas';
import { QuestionCircleOutlined } from '@ant-design/icons';
import {
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tooltip,
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

type EditorMode = 'simple' | 'detailed';

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
  const previousSni = settings.tls.sni;
  const previousEmail = settings.tls.email;
  const previousDefaultEmail = defaultAcmeEmail(previousSni);
  const nextEmail = defaultAcmeEmail(host);
  const shouldSyncEmail =
    Boolean(nextEmail) &&
    (!previousEmail ||
      (previousDefaultEmail !== undefined && previousEmail === previousDefaultEmail));

  return {
    ...settings,
    tls: {
      ...settings.tls,
      sni: host,
      domains: host ? [host] : [],
      provider: settings.tls.provider || 'letsencrypt',
      ...(shouldSyncEmail && nextEmail ? { email: nextEmail } : {}),
    },
  };
}

function isProbablyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sanitizeInboundForm(
  values: InboundEditorForm,
  defaultsContext: InboundDefaultsContext,
): InboundEditorForm {
  let settings = structuredClone(values.settings);
  const host = settings.publicHost?.trim() ?? '';

  // Ant Design onFinish only returns registered fields; simple mode hides most TLS
  // keys, so rebuild defaults and overlay whatever the form still has.
  if (values.protocol === 'HYSTERIA2' || values.protocol === 'TROJAN') {
    const preset = buildDefaultInboundSettings(
      values.protocol,
      {
        publicHost: host || defaultsContext.publicHost,
        acmeHttpPort: defaultsContext.acmeHttpPort,
        acmeTlsPort: defaultsContext.acmeTlsPort,
        tlsCertificatePath: defaultsContext.tlsCertificatePath,
        tlsKeyPath: defaultsContext.tlsKeyPath,
      },
      listenOverrides(settings),
    ) as Extract<
      ReturnType<typeof buildDefaultInboundSettings>,
      { tls: unknown }
    >;
    const presetTls = preset.tls;
    const formTls =
      'tls' in settings && settings.tls && typeof settings.tls === 'object'
        ? settings.tls
        : { mode: presetTls.mode };
    const formMode =
      'mode' in formTls && (formTls.mode === 'ACME' || formTls.mode === 'FILES')
        ? formTls.mode
        : presetTls.mode;

    if (formMode === 'FILES') {
      const presetFiles = presetTls.mode === 'FILES' ? presetTls : null;
      const certificatePath =
        ('certificatePath' in formTls && typeof formTls.certificatePath === 'string'
          ? formTls.certificatePath
          : undefined) ||
        presetFiles?.certificatePath ||
        defaultsContext.tlsCertificatePath ||
        undefined;
      const keyPath =
        ('keyPath' in formTls && typeof formTls.keyPath === 'string'
          ? formTls.keyPath
          : undefined) ||
        presetFiles?.keyPath ||
        defaultsContext.tlsKeyPath ||
        undefined;
      settings = {
        ...preset,
        ...settings,
        tls: {
          ...(presetFiles ?? {
            mode: 'FILES' as const,
            sni: host || defaultsContext.publicHost,
            alpn: ['h3'],
            minVersion: '1.2' as const,
            cipherSuites: [],
            curvePreferences: [],
            kernelTx: false,
            kernelRx: false,
            clientInsecure: false,
            certificatePath: certificatePath!,
            keyPath: keyPath!,
          }),
          ...('mode' in formTls && formTls.mode === 'FILES' ? formTls : {}),
          mode: 'FILES',
          sni:
            ('sni' in formTls && typeof formTls.sni === 'string' && formTls.sni) ||
            host ||
            presetFiles?.sni ||
            defaultsContext.publicHost,
          certificatePath: certificatePath!,
          keyPath: keyPath!,
        },
      };
    } else {
      const acmePreset =
        presetTls.mode === 'ACME'
          ? presetTls
          : (
              buildDefaultInboundSettings(
                values.protocol,
                {
                  publicHost: host || defaultsContext.publicHost,
                  acmeHttpPort: defaultsContext.acmeHttpPort,
                  acmeTlsPort: defaultsContext.acmeTlsPort,
                },
                listenOverrides(settings),
              ) as Extract<ReturnType<typeof buildDefaultInboundSettings>, { tls: unknown }>
            ).tls;
      if (acmePreset.mode !== 'ACME') {
        return { ...values, settings };
      }
      const formDomains =
        'domains' in formTls && Array.isArray(formTls.domains) ? formTls.domains : undefined;
      const formSni = 'sni' in formTls && typeof formTls.sni === 'string' ? formTls.sni : undefined;
      const formEmail =
        'email' in formTls && typeof formTls.email === 'string' ? formTls.email.trim() : undefined;
      const formProvider =
        'provider' in formTls && typeof formTls.provider === 'string'
          ? formTls.provider.trim()
          : undefined;

      settings = {
        ...preset,
        ...settings,
        tls: {
          ...acmePreset,
          ...('mode' in formTls && formTls.mode === 'ACME' ? formTls : {}),
          mode: 'ACME',
          sni: formSni || host || acmePreset.sni,
          domains: formDomains?.length ? formDomains : host ? [host] : acmePreset.domains,
          provider: formProvider || 'letsencrypt',
          dataDirectory:
            ('dataDirectory' in formTls && typeof formTls.dataDirectory === 'string'
              ? formTls.dataDirectory
              : undefined) || acmePreset.dataDirectory,
        },
      };

      const acmeTls = settings.tls;
      if (acmeTls.mode === 'ACME') {
        if (formEmail && isProbablyEmail(formEmail)) {
          acmeTls.email = formEmail;
        } else {
          const fallback = defaultAcmeEmail(settings.publicHost);
          if (fallback) {
            acmeTls.email = fallback;
          } else {
            delete acmeTls.email;
          }
        }
      }
    }
  }

  if ('obfs' in settings && settings.obfs) {
    const password = settings.obfs.password?.trim();
    if (password) {
      settings.obfs.password = password;
    } else {
      delete settings.obfs.password;
    }
  }

  if ('password' in settings && typeof settings.password === 'string') {
    const password = settings.password.trim();
    if (password) {
      settings.password = password;
    } else {
      delete settings.password;
    }
  }

  return { ...values, settings };
}

function FieldHelpLabel({ label, help }: { label: string; help: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      <Tooltip title={help}>
        <QuestionCircleOutlined style={{ color: 'rgba(0, 0, 0, 0.45)', cursor: 'help' }} />
      </Tooltip>
    </span>
  );
}

function AcmeTlsFields({ detailed }: { detailed: boolean }) {
  const { t } = useTranslation();

  return (
    <>
      <Form.Item name={['settings', 'tls', 'provider']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={['settings', 'tls', 'dataDirectory']} hidden>
        <Input />
      </Form.Item>
      {detailed ? (
        <>
          <Form.Item
            name={['settings', 'tls', 'sni']}
            label={t('inbounds.tlsSni')}
            rules={[{ required: true }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name={['settings', 'tls', 'domains']}
            label={t('inbounds.acmeDomains')}
            rules={[{ required: true }]}
          >
            <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Form.Item
            name={['settings', 'tls', 'email']}
            label={
              <FieldHelpLabel label={t('inbounds.acmeEmail')} help={t('inbounds.acmeEmailHelp')} />
            }
          >
            <Input type="email" autoComplete="off" name="acme-contact-email" />
          </Form.Item>
        </>
      ) : (
        <>
          <Form.Item name={['settings', 'tls', 'sni']} hidden>
            <Input />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'domains']} hidden>
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'email']} hidden>
            <Input />
          </Form.Item>
        </>
      )}
    </>
  );
}

function FileTlsHiddenFields() {
  return (
    <>
      <Form.Item name={['settings', 'tls', 'sni']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={['settings', 'tls', 'certificatePath']} hidden>
        <Input />
      </Form.Item>
      <Form.Item name={['settings', 'tls', 'keyPath']} hidden>
        <Input />
      </Form.Item>
    </>
  );
}

function TlsModeFields({ detailed }: { detailed: boolean }) {
  const { t } = useTranslation();
  const form = Form.useFormInstance<InboundEditorForm>();
  const tlsMode = Form.useWatch(['settings', 'tls', 'mode'], form);

  return (
    <>
      {detailed ? (
        <Form.Item name={['settings', 'tls', 'mode']} label={t('inbounds.tlsMode')}>
          <Select
            options={[
              { value: 'ACME', label: t('inbounds.tlsAcme') },
              { value: 'FILES', label: t('inbounds.tlsFiles') },
            ]}
          />
        </Form.Item>
      ) : (
        <Form.Item name={['settings', 'tls', 'mode']} hidden>
          <Input />
        </Form.Item>
      )}
      {tlsMode === 'ACME' ? <AcmeTlsFields detailed={detailed} /> : null}
      {tlsMode === 'FILES' && detailed ? (
        <>
          <Form.Item
            name={['settings', 'tls', 'certificatePath']}
            label={t('inbounds.certificatePath')}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'keyPath']} label={t('inbounds.keyPath')}>
            <Input autoComplete="off" />
          </Form.Item>
        </>
      ) : null}
      {tlsMode === 'FILES' && !detailed ? <FileTlsHiddenFields /> : null}
    </>
  );
}

function Hysteria2Fields({ detailed }: { detailed: boolean }) {
  const { t } = useTranslation();
  const form = Form.useFormInstance<InboundEditorForm>();
  const obfsEnabled = Form.useWatch(['settings', 'obfs'], form) !== null;

  return (
    <>
      <TlsModeFields detailed={detailed} />
      {detailed ? (
        <>
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
          <Form.Item
            label={<FieldHelpLabel label={t('inbounds.obfs')} help={t('inbounds.obfsHelp')} />}
          >
            <Switch
              checked={obfsEnabled}
              onChange={(checked) => {
                form.setFieldValue(['settings', 'obfs'], checked ? { type: 'SALAMANDER' } : null);
              }}
            />
          </Form.Item>
          {obfsEnabled ? (
            <Form.Item
              name={['settings', 'obfs', 'password']}
              label={t('inbounds.obfsPassword')}
              rules={[{ required: true, min: 8 }]}
            >
              <Input.Password autoComplete="new-password" name="hysteria-obfs-password" />
            </Form.Item>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function TrojanFields({ detailed }: { detailed: boolean }) {
  const { t } = useTranslation();
  const form = Form.useFormInstance<InboundEditorForm>();
  const fallbackEnabled = Form.useWatch(['settings', 'fallback'], form) !== null;

  return (
    <>
      <TlsModeFields detailed={detailed} />
      {detailed ? (
        <>
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
                <Input autoComplete="off" />
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
      ) : null}
    </>
  );
}

function VlessRealityFields({ detailed }: { detailed: boolean }) {
  const { t } = useTranslation();

  return (
    <>
      <Space size="large" wrap>
        <Form.Item
          name={['settings', 'handshakeServer']}
          label={t('inbounds.realityHandshake')}
          rules={[{ required: true }]}
        >
          <Input autoComplete="off" />
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
      {detailed ? (
        <>
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
      ) : (
        <>
          <Form.Item name={['settings', 'shortIds']} hidden>
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name={['settings', 'flow']} hidden>
            <Input />
          </Form.Item>
          <Form.Item name={['settings', 'fingerprint']} hidden>
            <Input />
          </Form.Item>
        </>
      )}
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
        <Input.Password
          placeholder={t('inbounds.secretPresent')}
          autoComplete="new-password"
          name="shadowsocks-password"
        />
      </Form.Item>
    </>
  );
}

function ProtocolFields({
  protocol,
  detailed,
}: {
  protocol: InboundProtocol | undefined;
  detailed: boolean;
}) {
  switch (protocol) {
    case 'HYSTERIA2':
      return <Hysteria2Fields detailed={detailed} />;
    case 'TROJAN':
      return <TrojanFields detailed={detailed} />;
    case 'VLESS_REALITY':
      return <VlessRealityFields detailed={detailed} />;
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
  const [editorMode, setEditorMode] = useState<EditorMode>('simple');
  const [advancedJson, setAdvancedJson] = useState('');
  const [advancedTouched, setAdvancedTouched] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const detailed = editorMode === 'detailed';

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
      tlsCertificatePath: settingsQuery.data.readOnly.tlsCertificatePath,
      tlsKeyPath: settingsQuery.data.readOnly.tlsKeyPath,
    };
  }, [inbound, settingsQuery.data, settingsQuery.isSuccess]);

  const saveMutation = useMutation({
    mutationFn: async (values: InboundEditorForm) => {
      if (!defaultsContext) {
        throw new Error('Inbound defaults are not ready');
      }
      const sanitized = sanitizeInboundForm(values, defaultsContext);
      const body = {
        tag: sanitized.tag,
        protocol: sanitized.protocol,
        settings: sanitized.settings,
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
      setEditorMode('simple');
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
    setEditorMode(inbound ? 'detailed' : 'simple');
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
        <Form
          form={form}
          layout="vertical"
          autoComplete="off"
          onFinish={() => {
            // Include values set via setFieldsValue but not bound to visible Form.Items.
            const values = form.getFieldsValue(true) as InboundEditorForm;
            saveMutation.mutate(values);
          }}
        >
          <Form.Item style={{ marginBottom: 16 }}>
            <Segmented<EditorMode>
              value={editorMode}
              onChange={setEditorMode}
              options={[
                { value: 'simple', label: t('inbounds.modeSimple') },
                { value: 'detailed', label: t('inbounds.modeDetailed') },
              ]}
            />
            {!detailed ? (
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                {t('inbounds.modeSimpleHint')}
              </Typography.Text>
            ) : null}
          </Form.Item>

          <Form.Item name="tag" label={t('inbounds.tag')} rules={[{ required: true }]}>
            <Input disabled={!!inbound} autoComplete="off" />
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

          {detailed ? (
            <>
              <Typography.Title level={5}>{t('inbounds.sectionListen')}</Typography.Title>
              <Space size="large" wrap>
                <Form.Item
                  name={['settings', 'listenHost']}
                  label={t('inbounds.listenHost')}
                  rules={[{ required: true }]}
                >
                  <Input style={{ width: 220 }} autoComplete="off" />
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
                    autoComplete="off"
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
            </>
          ) : (
            <Space size="large" wrap>
              <Form.Item
                name={['settings', 'publicHost']}
                label={t('inbounds.publicHost')}
                rules={[{ required: true, message: t('inbounds.publicHostRequired') }]}
              >
                <Input
                  style={{ width: 280 }}
                  autoComplete="off"
                  onChange={(event) => handlePublicHostChange(event.target.value)}
                />
              </Form.Item>
              <Form.Item
                name={['settings', 'listenPort']}
                label={t('inbounds.listenPort')}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={65535} style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name={['settings', 'listenHost']} hidden>
                <Input />
              </Form.Item>
              <Form.Item name={['settings', 'publicPort']} hidden>
                <InputNumber />
              </Form.Item>
            </Space>
          )}
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

          {detailed || protocol === 'VLESS_REALITY' || protocol === 'SHADOWSOCKS' ? (
            <>
              <Typography.Title level={5}>{t('inbounds.sectionProtocol')}</Typography.Title>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                {protocol ? t(`enums.protocol.${protocol}`, { defaultValue: protocol }) : '—'} ·{' '}
                {t('inbounds.secretPresent')}
              </Typography.Text>
              <ProtocolFields protocol={protocol} detailed={detailed} />
            </>
          ) : (
            <ProtocolFields protocol={protocol} detailed={detailed} />
          )}

          {detailed ? (
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
          ) : null}
        </Form>
      ) : null}
    </Drawer>
  );
}
