import { useEffect } from 'react';
import { Button, Card, Form, Input, InputNumber, Switch, Table, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { checkForUpdates, getDashboard, getSystemHealth, getUpdateStatus } from '@/api/system';
import { getSettings, updateSettings } from '@/api/settings';
import { useAuth } from '@/auth/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { localizedRuntimeError } from '@/utils/localizeRuntimeError';
import dayjs from 'dayjs';

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { canMutate } = useAuth();
  const showError = useApiErrorHandler();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const isRu = i18n.language.startsWith('ru');

  const healthQuery = useQuery({
    queryKey: ['system-health-detail'],
    queryFn: getSystemHealth,
    refetchInterval: 15_000,
  });

  const dashboardQuery = useQuery({
    queryKey: ['system-dashboard-meta'],
    queryFn: () => getDashboard(),
  });

  const settingsQuery = useQuery({
    queryKey: ['system-settings'],
    queryFn: getSettings,
  });

  const updateQuery = useQuery({
    queryKey: ['system-updates'],
    queryFn: getUpdateStatus,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) {
      return;
    }
    form.setFieldsValue({
      panelUrl: settings.panelUrl ?? '',
      subPublicBaseUrl: settings.subPublicBaseUrl,
      profileUpdateIntervalHours: settings.profileUpdateIntervalHours,
      notifyTelegramEnabled: settings.notifyTelegramEnabled,
      telegramBotToken: '',
      telegramChatId: '',
    });
  }, [form, settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      message.success(t('app.success'));
    },
    onError: showError,
  });

  const checkUpdateMutation = useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (status) => {
      void queryClient.invalidateQueries({ queryKey: ['system-updates'] });
      if (status.updateAvailable) {
        message.info(t('system.updateFound'));
      } else if (status.error) {
        message.warning(
          localizedRuntimeError(status.error, i18n.language, status.errorRu) ??
            t('system.updateCheckFailed'),
        );
      } else {
        message.success(t('system.updateUpToDate'));
      }
    },
    onError: showError,
  });

  const health = healthQuery.data;
  const dashboard = dashboardQuery.data;
  const settings = settingsQuery.data;
  const update = updateQuery.data;

  return (
    <div>
      <PageHeader title={t('system.title')} />

      <Card
        size="small"
        title={t('system.updates')}
        style={{ marginBottom: 12 }}
        loading={updateQuery.isLoading}
        extra={
          <Button
            size="small"
            disabled={!canMutate}
            loading={checkUpdateMutation.isPending}
            onClick={() => checkUpdateMutation.mutate()}
          >
            {t('system.checkUpdates')}
          </Button>
        }
      >
        {update ? (
          <Table<{ field: string; value: string }>
            size="small"
            pagination={false}
            rowKey="field"
            dataSource={[
              {
                field: t('system.updateStatus'),
                value: update.updateAvailable
                  ? t('system.updateAvailable')
                  : update.currentKnown
                    ? t('system.updateUpToDate')
                    : t('system.updateUnknown'),
              },
              {
                field: t('system.updateChannel'),
                value: update.channel,
              },
              {
                field: t('system.currentSha'),
                value: update.currentSha?.slice(0, 12) ?? '—',
              },
              {
                field: t('system.latestSha'),
                value: update.latestShortSha ?? update.latestSha?.slice(0, 12) ?? '—',
              },
              {
                field: t('system.lastChecked'),
                value: update.checkedAt
                  ? dayjs(update.checkedAt).format('YYYY-MM-DD HH:mm:ss')
                  : '—',
              },
              {
                field: t('system.applyUpdate'),
                value: isRu ? update.applyHintRu : update.applyHint,
              },
              {
                field: t('app.error'),
                value: localizedRuntimeError(update.error, i18n.language, update.errorRu) ?? '—',
              },
            ]}
            columns={[
              { title: t('app.field'), dataIndex: 'field' },
              {
                title: t('app.value'),
                dataIndex: 'value',
                render: (value: string, row) =>
                  row.field === t('system.latestSha') && update.latestHtmlUrl ? (
                    <a href={update.latestHtmlUrl} target="_blank" rel="noreferrer">
                      {value}
                    </a>
                  ) : (
                    value
                  ),
              },
            ]}
          />
        ) : null}
      </Card>

      <Card
        size="small"
        title={t('system.settings')}
        loading={settingsQuery.isLoading}
        style={{ marginBottom: 12 }}
      >
        {settings ? (
          <>
            <Form
              form={form}
              layout="vertical"
              disabled={!canMutate}
              onFinish={(values) => {
                const payload: Parameters<typeof updateSettings>[0] = {
                  panelUrl: values.panelUrl || null,
                  subPublicBaseUrl: values.subPublicBaseUrl,
                  profileUpdateIntervalHours: values.profileUpdateIntervalHours,
                  notifyTelegramEnabled: values.notifyTelegramEnabled,
                };
                if (values.telegramBotToken) {
                  payload.telegramBotToken = values.telegramBotToken;
                }
                if (values.telegramChatId) {
                  payload.telegramChatId = values.telegramChatId;
                }
                saveMutation.mutate(payload);
              }}
            >
              <Form.Item name="panelUrl" label={t('system.panelUrl')}>
                <Input placeholder={t('system.panelUrlPlaceholder')} />
              </Form.Item>
              <Form.Item
                name="subPublicBaseUrl"
                label={t('system.subPublicBaseUrl')}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="profileUpdateIntervalHours"
                label={t('system.profileUpdateIntervalHours')}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={168} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                name="notifyTelegramEnabled"
                label={t('system.notifyTelegramEnabled')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name="telegramBotToken"
                label={t('system.telegramBotToken')}
                extra={
                  settings.telegramBotTokenConfigured
                    ? t('system.secretConfigured')
                    : t('system.secretMissing')
                }
              >
                <Input.Password
                  placeholder={t('system.secretWriteOnly')}
                  autoComplete="new-password"
                />
              </Form.Item>
              <Form.Item
                name="telegramChatId"
                label={t('system.telegramChatId')}
                extra={
                  settings.telegramChatIdConfigured
                    ? t('system.secretConfigured')
                    : t('system.secretMissing')
                }
              >
                <Input placeholder={t('system.secretWriteOnly')} />
              </Form.Item>
              {canMutate ? (
                <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
                  {t('app.save')}
                </Button>
              ) : null}
            </Form>
            <div style={{ marginTop: 16, fontSize: 13, color: '#64748b' }}>
              {t('system.revision')}: {settings.revision} · {t('system.envSubUrl')}:{' '}
              {settings.readOnly.subPublicBaseUrlEnv} · {t('system.corsOrigins')}:{' '}
              {settings.readOnly.corsOriginsCount} · {t('system.workersEnabled')}:{' '}
              {settings.readOnly.workersEnabled ? t('app.yes') : t('app.no')} ·{' '}
              {t('system.backupEncrypt')}:{' '}
              {settings.readOnly.backupEncrypt ? t('app.yes') : t('app.no')}
            </div>
          </>
        ) : null}
      </Card>

      <Card size="small" title={t('system.health')} loading={healthQuery.isLoading}>
        {health ? (
          <>
            <Tag color={health.status === 'ok' ? 'green' : 'orange'}>
              {health.status === 'ok' ? t('system.statusOk') : t('system.statusDegraded')}
            </Tag>
            <span style={{ marginLeft: 8, color: '#64748b' }}>
              {dayjs(health.checkedAt).format('YYYY-MM-DD HH:mm:ss')}
            </span>
          </>
        ) : null}
      </Card>

      <Card
        size="small"
        title={t('system.core')}
        style={{ marginTop: 12 }}
        loading={healthQuery.isLoading}
      >
        <Table
          size="small"
          pagination={false}
          rowKey="field"
          dataSource={
            health
              ? [
                  {
                    field: t('dashboard.healthy'),
                    value: health.core.healthy ? t('app.yes') : t('app.no'),
                  },
                  {
                    field: t('dashboard.version'),
                    value: health.core.version ?? '—',
                  },
                  {
                    field: t('dashboard.latency'),
                    value: `${health.core.latencyMs} ms`,
                  },
                  {
                    field: t('app.error'),
                    value:
                      localizedRuntimeError(
                        health.core.error,
                        i18n.language,
                        health.core.errorRu,
                      ) ?? '—',
                  },
                  ...Object.entries(health.core.engines ?? {}).flatMap(([engine, engineHealth]) => [
                    {
                      field: t('system.coreEngine', {
                        engine: t(`enums.coreEngine.${engine}`),
                      }),
                      value: engineHealth.healthy
                        ? t('dashboard.healthy')
                        : t('dashboard.unhealthy'),
                    },
                    {
                      field: t('system.coreEngineVersion', {
                        engine: t(`enums.coreEngine.${engine}`),
                      }),
                      value: `${engineHealth.version ?? '—'} · ${engineHealth.latencyMs} ms`,
                    },
                  ]),
                ]
              : []
          }
          columns={[
            { title: t('app.field'), dataIndex: 'field' },
            { title: t('app.value'), dataIndex: 'value' },
          ]}
        />
      </Card>

      <Card
        size="small"
        title={t('system.workers')}
        style={{ marginTop: 12 }}
        loading={healthQuery.isLoading || dashboardQuery.isLoading}
      >
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          dataSource={health?.workers ?? dashboard?.workers ?? []}
          columns={[
            {
              title: t('app.name'),
              dataIndex: 'name',
              render: (name: string) => t(`enums.workerName.${name}`, { defaultValue: name }),
            },
            {
              title: t('dashboard.workerState'),
              dataIndex: 'state',
              render: (state: string) => (
                <Tag>{t(`enums.workerState.${state}`, { defaultValue: state })}</Tag>
              ),
            },
            {
              title: t('dashboard.lastSuccess'),
              dataIndex: 'lastSuccessAt',
              render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '—'),
            },
            {
              title: t('app.error'),
              dataIndex: 'error',
              ellipsis: true,
              render: (v: string | null) => localizedRuntimeError(v, i18n.language) || '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
