import {
  buildDefaultInboundSettings,
  defaultAcmeEmail,
  PROTOCOL_ENGINE_MAP,
  publishedListenPortForProtocol,
  publishedTransportForProtocol,
  type InboundDefaultsContext,
  type InboundListenOverrides,
} from '@overvpn/shared';
import type { InboundProtocol } from '@overvpn/shared/constants';
import type { CreateInbound, InboundResult } from '@overvpn/shared/schemas';
import { QuestionCircleOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Alert,
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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createInbound, updateInbound } from '@/api/inbounds';
import { getSettings } from '@/api/settings';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { notifyCoreApply } from '@/utils/notifyCoreApply';

const SING_BOX_PROTOCOLS: InboundProtocol[] = [
  'HYSTERIA2',
  'VLESS_REALITY',
  'TROJAN',
  'SHADOWSOCKS',
];
const XRAY_PROTOCOLS: InboundProtocol[] = ['VLESS_XHTTP_TLS'];

const VLESS_FLOWS = ['', 'xtls-rprx-vision'] as const;
const VLESS_XHTTP_MODES = ['auto', 'packet-up', 'stream-up', 'stream-one'] as const;
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
  displayNameTemplate?: string | null;
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

function syncTlsPublicHost(
  settings: InboundEditorForm['settings'],
  host: string,
): InboundEditorForm['settings'] {
  if (!('tls' in settings)) {
    return settings;
  }
  if (settings.tls.mode === 'ACME') {
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
    } as InboundEditorForm['settings'];
  }
  if (settings.tls.mode === 'FILES') {
    return {
      ...settings,
      tls: {
        ...settings.tls,
        sni: host,
      },
    } as InboundEditorForm['settings'];
  }
  return settings;
}

function isProbablyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type DirtySettings = Record<string, unknown>;

function asDirtySettings(settings: InboundEditorForm['settings']): DirtySettings {
  return settings as unknown as DirtySettings;
}

/** Copy only keys that exist on the protocol preset — drops leftovers from other protocols. */
function overlayPresetKeys<T extends Record<string, unknown>>(
  preset: T,
  dirty: DirtySettings,
  extraKeys: readonly string[] = [],
): T {
  const next = { ...preset };
  for (const key of Object.keys(preset)) {
    if (key === 'tls') {
      continue;
    }
    if (key in dirty && dirty[key] !== undefined) {
      (next as DirtySettings)[key] = dirty[key];
    }
  }
  for (const key of extraKeys) {
    if (key in dirty && dirty[key] !== undefined) {
      (next as DirtySettings)[key] = dirty[key];
    }
  }
  return next;
}

function stripPublicTlsLeftovers(tls: DirtySettings): void {
  delete tls.certificatePemPresent;
  delete tls.privateKeyPemPresent;
}

function resolveSingBoxTls(
  protocol: 'HYSTERIA2' | 'TROJAN',
  presetTls: Extract<ReturnType<typeof buildDefaultInboundSettings>, { tls: unknown }>['tls'],
  dirty: DirtySettings,
  host: string,
  defaultsContext: InboundDefaultsContext,
  overrides: InboundListenOverrides,
): Extract<ReturnType<typeof buildDefaultInboundSettings>, { tls: unknown }>['tls'] {
  const formTls =
    dirty.tls && typeof dirty.tls === 'object'
      ? (dirty.tls as DirtySettings)
      : { mode: presetTls.mode };
  const formMode =
    formTls.mode === 'ACME' || formTls.mode === 'FILES' ? formTls.mode : presetTls.mode;

  if (formMode === 'FILES') {
    const presetFiles = presetTls.mode === 'FILES' ? presetTls : null;
    const certificatePath =
      (typeof formTls.certificatePath === 'string' ? formTls.certificatePath : undefined) ||
      presetFiles?.certificatePath ||
      defaultsContext.tlsCertificatePath ||
      undefined;
    const keyPath =
      (typeof formTls.keyPath === 'string' ? formTls.keyPath : undefined) ||
      presetFiles?.keyPath ||
      defaultsContext.tlsKeyPath ||
      undefined;
    const tls = {
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
      ...(formTls.mode === 'FILES' ? formTls : {}),
      mode: 'FILES' as const,
      sni:
        (typeof formTls.sni === 'string' && formTls.sni) ||
        host ||
        presetFiles?.sni ||
        defaultsContext.publicHost,
      certificatePath: certificatePath!,
      keyPath: keyPath!,
    };
    stripPublicTlsLeftovers(tls as DirtySettings);
    return tls as Extract<ReturnType<typeof buildDefaultInboundSettings>, { tls: unknown }>['tls'];
  }

  const acmePreset =
    presetTls.mode === 'ACME'
      ? presetTls
      : (
          buildDefaultInboundSettings(
            protocol,
            {
              publicHost: host || defaultsContext.publicHost,
              acmeHttpPort: defaultsContext.acmeHttpPort,
              acmeTlsPort: defaultsContext.acmeTlsPort,
            },
            overrides,
          ) as Extract<ReturnType<typeof buildDefaultInboundSettings>, { tls: unknown }>
        ).tls;
  if (acmePreset.mode !== 'ACME') {
    return presetTls;
  }
  const formDomains = Array.isArray(formTls.domains) ? formTls.domains : undefined;
  const formSni = typeof formTls.sni === 'string' ? formTls.sni : undefined;
  const formEmail = typeof formTls.email === 'string' ? formTls.email.trim() : undefined;
  const formProvider = typeof formTls.provider === 'string' ? formTls.provider.trim() : undefined;
  const tls = {
    ...acmePreset,
    ...(formTls.mode === 'ACME' ? formTls : {}),
    mode: 'ACME' as const,
    sni: formSni || host || acmePreset.sni,
    domains: formDomains?.length ? formDomains : host ? [host] : acmePreset.domains,
    provider: formProvider || 'letsencrypt',
    dataDirectory:
      (typeof formTls.dataDirectory === 'string' ? formTls.dataDirectory : undefined) ||
      acmePreset.dataDirectory,
  };
  stripPublicTlsLeftovers(tls as DirtySettings);
  if (formEmail && isProbablyEmail(formEmail)) {
    tls.email = formEmail;
  } else {
    const fallback = defaultAcmeEmail(host || defaultsContext.publicHost);
    if (fallback) {
      tls.email = fallback;
    } else {
      delete tls.email;
    }
  }
  return tls;
}

function resolveXhttpTls(
  dirty: DirtySettings,
  host: string,
  defaultsContext: InboundDefaultsContext,
): {
  mode: 'FILES';
  sni: string;
  certificatePath?: string;
  keyPath?: string;
  certificatePem?: string;
  privateKeyPem?: string;
} {
  const formTls = dirty.tls && typeof dirty.tls === 'object' ? (dirty.tls as DirtySettings) : {};
  const certificatePem =
    typeof formTls.certificatePem === 'string' ? formTls.certificatePem : undefined;
  const privateKeyPem =
    typeof formTls.privateKeyPem === 'string' ? formTls.privateKeyPem : undefined;
  const sni =
    (typeof formTls.sni === 'string' && formTls.sni) || host || defaultsContext.publicHost;
  if (certificatePem && privateKeyPem) {
    return { mode: 'FILES', sni, certificatePem, privateKeyPem };
  }
  return {
    mode: 'FILES',
    sni,
    certificatePath:
      (typeof formTls.certificatePath === 'string' ? formTls.certificatePath : undefined) ||
      defaultsContext.tlsCertificatePath ||
      undefined,
    keyPath:
      (typeof formTls.keyPath === 'string' ? formTls.keyPath : undefined) ||
      defaultsContext.tlsKeyPath ||
      undefined,
  };
}

/**
 * Ant Design keeps stale nested keys when switching protocols (`setFieldsValue` merges).
 * Always rebuild from protocol defaults and overlay only keys that belong to that protocol.
 */
export function sanitizeInboundForm(
  values: InboundEditorForm,
  defaultsContext: InboundDefaultsContext,
): InboundEditorForm {
  const dirty = asDirtySettings(structuredClone(values.settings));
  const host = typeof dirty.publicHost === 'string' ? dirty.publicHost.trim() : '';
  const context: InboundDefaultsContext = {
    ...defaultsContext,
    publicHost: host || defaultsContext.publicHost,
  };
  const overrides = listenOverrides(values.settings);

  if (values.protocol === 'VLESS_XHTTP_TLS') {
    let preset: ReturnType<typeof buildDefaultInboundSettings>;
    try {
      preset = buildDefaultInboundSettings('VLESS_XHTTP_TLS', context, overrides);
    } catch {
      preset = {
        listenHost: overrides.listenHost ?? '0.0.0.0',
        listenPort: overrides.listenPort ?? defaultsContext.xrayListenPort ?? 8443,
        publicHost: host || defaultsContext.publicHost,
        publicPort: overrides.publicPort,
        enabled: overrides.enabled ?? true,
        path: '/',
        host: host || defaultsContext.publicHost || null,
        mode: 'auto',
        tls: {
          mode: 'FILES',
          sni: host || defaultsContext.publicHost,
          certificatePath: defaultsContext.tlsCertificatePath?.trim() || undefined,
          keyPath: defaultsContext.tlsKeyPath?.trim() || undefined,
        },
      };
    }
    const settings = overlayPresetKeys(
      preset as Record<string, unknown>,
      dirty,
    ) as typeof preset & { tls: ReturnType<typeof resolveXhttpTls> };
    settings.tls = resolveXhttpTls(dirty, host, defaultsContext);
    return { ...values, settings: settings as InboundEditorForm['settings'] };
  }

  if (values.protocol === 'HYSTERIA2' || values.protocol === 'TROJAN') {
    const preset = buildDefaultInboundSettings(values.protocol, context, overrides) as Extract<
      ReturnType<typeof buildDefaultInboundSettings>,
      { tls: unknown }
    >;
    const settings = overlayPresetKeys(preset as Record<string, unknown>, dirty) as typeof preset;
    settings.tls = resolveSingBoxTls(
      values.protocol,
      preset.tls,
      dirty,
      host,
      defaultsContext,
      overrides,
    );
    if ('obfs' in settings && settings.obfs && typeof settings.obfs === 'object') {
      // Public inbound config uses passwordPresent; write schema only accepts password.
      const raw = settings.obfs as { type?: string; password?: string };
      if (raw.type === 'SALAMANDER') {
        const password = raw.password?.trim();
        (settings as { obfs: unknown }).obfs = password
          ? { type: 'SALAMANDER', password }
          : { type: 'SALAMANDER' };
      }
    }
    return { ...values, settings: settings as InboundEditorForm['settings'] };
  }

  if (values.protocol === 'VLESS_REALITY') {
    const preset = buildDefaultInboundSettings('VLESS_REALITY', context, overrides);
    const settings = overlayPresetKeys(preset as Record<string, unknown>, dirty, [
      'privateKey',
      'publicKey',
    ]) as typeof preset & Record<string, unknown>;
    delete settings.publicKeyPresent;
    delete settings.privateKeyPresent;
    return { ...values, settings: settings as InboundEditorForm['settings'] };
  }

  const preset = buildDefaultInboundSettings('SHADOWSOCKS', context, overrides);
  const settings = overlayPresetKeys(preset as Record<string, unknown>, dirty, [
    'password',
  ]) as typeof preset & { password?: string };
  if (typeof settings.password === 'string') {
    const password = settings.password.trim();
    if (password) {
      settings.password = password;
    } else {
      delete settings.password;
    }
  }
  return { ...values, settings: settings as InboundEditorForm['settings'] };
}

function replaceFormSettings(
  form: ReturnType<typeof Form.useForm<InboundEditorForm>>[0],
  protocol: InboundProtocol,
  nextSettings: InboundEditorForm['settings'],
): void {
  // setFields replaces the whole `settings` value; setFieldsValue merges nested keys.
  form.setFields([
    { name: 'protocol', value: protocol },
    { name: 'settings', value: nextSettings },
  ]);
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

function VlessXhttpTlsFields({ detailed }: { detailed: boolean }) {
  const { t } = useTranslation();

  return (
    <>
      <Form.Item
        name={['settings', 'path']}
        label={t('inbounds.xhttpPath')}
        rules={[{ required: true }]}
      >
        <Input autoComplete="off" placeholder="/" />
      </Form.Item>
      <Form.Item name={['settings', 'host']} label={t('inbounds.xhttpHost')}>
        <Input autoComplete="off" placeholder={t('inbounds.xhttpHostOptional')} />
      </Form.Item>
      <Form.Item
        name={['settings', 'mode']}
        label={t('inbounds.xhttpMode')}
        rules={[{ required: true }]}
      >
        <Select options={VLESS_XHTTP_MODES.map((value) => ({ value, label: value }))} />
      </Form.Item>
      <Form.Item name={['settings', 'tls', 'mode']} hidden>
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
            name={['settings', 'tls', 'certificatePath']}
            label={t('inbounds.certificatePath')}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name={['settings', 'tls', 'keyPath']} label={t('inbounds.keyPath')}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name={['settings', 'tls', 'certificatePem']}
            label={t('inbounds.certificatePem')}
          >
            <Input.TextArea rows={3} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name={['settings', 'tls', 'privateKeyPem']}
            label={t('inbounds.privateKeyPem')}
          >
            <Input.TextArea rows={3} autoComplete="off" />
          </Form.Item>
        </>
      ) : (
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
      )}
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
    case 'VLESS_XHTTP_TLS':
      return <VlessXhttpTlsFields detailed={detailed} />;
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message: messageApi } = AntApp.useApp();
  const [form] = Form.useForm<InboundEditorForm>();
  const onError = useApiErrorHandler(form);
  const protocol = Form.useWatch('protocol', form);
  const settings = Form.useWatch('settings', form);
  const [editorMode, setEditorMode] = useState<EditorMode>('simple');
  const [advancedJson, setAdvancedJson] = useState('');
  const [advancedTouched, setAdvancedTouched] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [protocolResetKey, setProtocolResetKey] = useState(0);
  const detailed = editorMode === 'detailed';

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: open,
  });

  const defaultsContext = useMemo((): InboundDefaultsContext | null => {
    if (!settingsQuery.isSuccess) {
      return null;
    }
    const readOnly = settingsQuery.data.readOnly;
    return {
      publicHost: inbound?.settings.publicHost ?? readOnly.vpnPublicHost?.trim() ?? '',
      acmeHttpPort: readOnly.acmeHttpPort,
      acmeTlsPort: readOnly.acmeTlsPort,
      singBoxUdpPort: readOnly.singBoxUdpPort,
      singBoxTcpPort: readOnly.singBoxTcpPort,
      singBoxTrojanPort: readOnly.singBoxTrojanPort,
      singBoxSsPort: readOnly.singBoxSsPort,
      xrayListenPort: readOnly.xrayListenPort,
      tlsCertificatePath: readOnly.tlsCertificatePath,
      tlsKeyPath: readOnly.tlsKeyPath,
    };
  }, [inbound, settingsQuery.data, settingsQuery.isSuccess]);

  const installPortInfo = useMemo(() => {
    if (!defaultsContext || !protocol) {
      return null;
    }
    return {
      port: publishedListenPortForProtocol(protocol, defaultsContext),
      transport: publishedTransportForProtocol(protocol),
    };
  }, [defaultsContext, protocol]);

  const saveMutation = useMutation({
    mutationFn: async (values: InboundEditorForm) => {
      if (!defaultsContext) {
        throw new Error('Inbound defaults are not ready');
      }
      if (
        values.protocol === 'VLESS_XHTTP_TLS' &&
        !defaultsContext.tlsCertificatePath?.trim() &&
        !defaultsContext.tlsKeyPath?.trim()
      ) {
        const hasPem =
          'tls' in values.settings &&
          values.settings.tls &&
          typeof values.settings.tls === 'object' &&
          'certificatePem' in values.settings.tls &&
          typeof values.settings.tls.certificatePem === 'string' &&
          values.settings.tls.certificatePem.trim() &&
          'privateKeyPem' in values.settings.tls &&
          typeof values.settings.tls.privateKeyPem === 'string' &&
          values.settings.tls.privateKeyPem.trim();
        const hasPaths =
          'tls' in values.settings &&
          values.settings.tls &&
          typeof values.settings.tls === 'object' &&
          'certificatePath' in values.settings.tls &&
          typeof values.settings.tls.certificatePath === 'string' &&
          values.settings.tls.certificatePath.trim() &&
          'keyPath' in values.settings.tls &&
          typeof values.settings.tls.keyPath === 'string' &&
          values.settings.tls.keyPath.trim();
        if (!hasPem && !hasPaths) {
          form.setFields([
            {
              name: ['settings', 'tls'],
              errors: [t('inbounds.xrayTlsPathsMissing')],
            },
          ]);
          void messageApi.error(t('inbounds.xrayTlsPathsMissing'));
          throw new Error('VLESS_XHTTP_TLS TLS certificate paths are not configured');
        }
      }
      if (!values.settings.publicHost?.trim()) {
        form.setFields([
          {
            name: ['settings', 'publicHost'],
            errors: [t('inbounds.publicHostRequired')],
          },
        ]);
        throw new Error('Public host is required');
      }
      let sanitized = sanitizeInboundForm(values, defaultsContext);
      if (editorMode === 'simple') {
        const port = publishedListenPortForProtocol(sanitized.protocol, defaultsContext);
        sanitized = {
          ...sanitized,
          settings: {
            ...sanitized.settings,
            listenPort: port,
            publicPort: port,
          } as InboundEditorForm['settings'],
        };
      }
      const body = {
        tag: sanitized.tag,
        protocol: sanitized.protocol,
        displayNameTemplate: values.displayNameTemplate?.trim() || null,
        settings: sanitized.settings,
      };
      if (inbound) {
        // Branding-only updates must not re-submit public config as write settings.
        // When the editor only changed the display name, send that field alone.
        const prevName = inbound.displayNameTemplate ?? null;
        const nextName = body.displayNameTemplate;
        const nameOnly =
          nextName !== prevName &&
          sanitized.tag === inbound.tag &&
          sanitized.protocol === inbound.protocol &&
          sanitized.settings.publicHost === inbound.settings.publicHost &&
          sanitized.settings.enabled === inbound.settings.enabled &&
          sanitized.settings.listenPort === inbound.settings.listenPort;
        if (nameOnly) {
          return updateInbound(inbound.id, {
            displayNameTemplate: nextName,
          });
        }
        return updateInbound(inbound.id, body);
      }
      return createInbound(body as CreateInbound);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      const { ok } = notifyCoreApply(result.apply, {
        t,
        messageApi,
        navigate,
      });
      if (ok) {
        onClose();
      }
    },
    onError: onError,
  });

  const initialProtocol = inbound?.protocol ?? 'HYSTERIA2';
  const isCreateLoading = settingsQuery.isLoading;
  const formReady = settingsQuery.isSuccess;

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
    form.setFields([
      { name: 'tag', value: inbound?.tag ?? '' },
      { name: 'displayNameTemplate', value: inbound?.displayNameTemplate ?? '' },
      { name: 'protocol', value: initialProtocol },
      { name: 'settings', value: initialSettings },
    ]);
    setEditorMode('simple');
    setAdvancedJson(JSON.stringify(initialSettings, null, 2));
    setAdvancedTouched(false);
    setProtocolResetKey(0);
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
    const current = form.getFieldsValue(true) as InboundEditorForm;
    // Drop listen/public ports so each protocol picks its install published port.
    const overrides = listenOverrides(current.settings);
    delete overrides.listenPort;
    delete overrides.publicPort;
    let nextSettings: InboundEditorForm['settings'];
    try {
      nextSettings = buildDefaultInboundSettings(value, defaultsContext, overrides);
    } catch {
      if (value !== 'VLESS_XHTTP_TLS') {
        return;
      }
      const port = publishedListenPortForProtocol(value, defaultsContext);
      nextSettings = {
        listenHost: current.settings?.listenHost ?? '0.0.0.0',
        listenPort: port,
        publicHost: current.settings?.publicHost ?? defaultsContext.publicHost,
        publicPort: port,
        enabled: current.settings?.enabled ?? true,
        path: '/',
        host: defaultsContext.publicHost || null,
        mode: 'auto',
        tls: {
          mode: 'FILES',
          sni: defaultsContext.publicHost,
          certificatePath: defaultsContext.tlsCertificatePath?.trim() || undefined,
          keyPath: defaultsContext.tlsKeyPath?.trim() || undefined,
        },
      };
    }
    replaceFormSettings(form, value, nextSettings);
    setProtocolResetKey((key) => key + 1);
    void messageApi.info(t('inbounds.protocolReset'));
    if (!advancedTouched) {
      setAdvancedJson(JSON.stringify(nextSettings, null, 2));
    }
  };

  const handlePublicHostChange = (host: string) => {
    const current = form.getFieldValue('settings') as InboundEditorForm['settings'];
    const next = syncTlsPublicHost({ ...current, publicHost: host }, host);
    form.setFields([{ name: 'settings', value: next }]);
  };

  const applyAdvancedJson = () => {
    try {
      const parsed = JSON.parse(advancedJson) as InboundEditorForm['settings'];
      const protocol = form.getFieldValue('protocol') as InboundProtocol;
      replaceFormSettings(form, protocol, parsed);
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
          <Form.Item
            name="displayNameTemplate"
            label={t('inbounds.displayNameTemplate')}
            extra={t('inbounds.displayNameTemplateHint')}
          >
            <Input placeholder="{identity} - {tag}" maxLength={200} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="protocol"
            label={t('inbounds.protocol')}
            extra={protocolResetKey > 0 ? t('inbounds.protocolReset') : undefined}
          >
            <Select
              disabled={!!inbound}
              options={[
                {
                  label: t('inbounds.engineGroupSingBox'),
                  options: SING_BOX_PROTOCOLS.map((value) => ({
                    value,
                    label: t(`enums.protocol.${value}`, {
                      defaultValue: t(`enums.inboundProtocol.${value}`, { defaultValue: value }),
                    }),
                  })),
                },
                {
                  label: t('inbounds.engineGroupXray'),
                  options: XRAY_PROTOCOLS.map((value) => ({
                    value,
                    label: t(`enums.protocol.${value}`, {
                      defaultValue: t(`enums.inboundProtocol.${value}`, { defaultValue: value }),
                    }),
                  })),
                },
              ]}
              onChange={handleProtocolChange}
            />
          </Form.Item>
          {protocol ? (
            <Form.Item label={t('inbounds.engine')}>
              <Tag>{t(`enums.coreEngine.${PROTOCOL_ENGINE_MAP[protocol]}`)}</Tag>
            </Form.Item>
          ) : null}
          {protocol === 'VLESS_XHTTP_TLS' && !defaultsContext?.tlsCertificatePath?.trim() ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('inbounds.xrayTlsPathsMissingShort')}
            />
          ) : null}

          {detailed ? (
            <>
              <Typography.Title level={5}>{t('inbounds.sectionListen')}</Typography.Title>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  installPortInfo
                    ? t('inbounds.installPortHint', {
                        port: installPortInfo.port,
                        transport: installPortInfo.transport.toUpperCase(),
                      })
                    : t('inbounds.installPort')
                }
              />
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
                  extra={t('inbounds.listenPortPublishedHint')}
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
            <Space size="large" wrap align="start">
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
              <Form.Item label={t('inbounds.installPort')}>
                <Typography.Text>
                  {installPortInfo
                    ? t('inbounds.installPortValue', {
                        port: installPortInfo.port,
                        transport: installPortInfo.transport.toUpperCase(),
                      })
                    : '—'}
                </Typography.Text>
              </Form.Item>
              <Form.Item name={['settings', 'listenPort']} hidden>
                <InputNumber />
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

          {detailed ||
          protocol === 'VLESS_REALITY' ||
          protocol === 'VLESS_XHTTP_TLS' ||
          protocol === 'SHADOWSOCKS' ? (
            <>
              <Typography.Title level={5}>{t('inbounds.sectionProtocol')}</Typography.Title>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                {protocol
                  ? t(`enums.protocol.${protocol}`, {
                      defaultValue: t(`enums.inboundProtocol.${protocol}`, {
                        defaultValue: protocol,
                      }),
                    })
                  : '—'}{' '}
                · {t('inbounds.secretPresent')}
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
