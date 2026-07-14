import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { archivePlan, createPlan, deletePlan, listPlans, updatePlan } from '@/api/plans';
import { listInbounds } from '@/api/inbounds';
import { PageHeader } from '@/components/PageHeader';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { formatBytes } from '@/utils/format';

const GIB = 1024 ** 3;
const MBPS_TO_BPS = 1_000_000;

type PlanFormValues = {
  name: string;
  description?: string | null;
  defaultDataLimitGiB?: number | null;
  defaultExpiryDays?: number | null;
  defaultDeviceLimit?: number | null;
  defaultSpeedLimitMbps?: number | null;
  defaultResetStrategy?: string;
  inboundIds?: string[];
  subscriptionTitleTemplate?: string | null;
  subscriptionAnnounce?: string | null;
  subscriptionSupportUrl?: string | null;
  subscriptionWebPageUrl?: string | null;
};

function bytesToGiB(bytes: string | null | undefined): number | null {
  if (!bytes) {
    return null;
  }
  try {
    return Number(BigInt(bytes)) / GIB;
  } catch {
    return null;
  }
}

function giBToBytes(giB: number | null | undefined): string | null {
  if (giB == null || Number.isNaN(giB)) {
    return null;
  }
  return String(Math.round(giB * GIB));
}

function bpsToMbps(bps: string | null | undefined): number | null {
  if (!bps) {
    return null;
  }
  try {
    return Number(BigInt(bps)) / MBPS_TO_BPS;
  } catch {
    return null;
  }
}

function mbpsToBps(mbps: number | null | undefined): string | null {
  if (mbps == null || Number.isNaN(mbps) || mbps <= 0) {
    return null;
  }
  return String(Math.round(mbps * MBPS_TO_BPS));
}

export function PlansPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canMutate } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<PlanFormValues>();
  const onError = useApiErrorHandler();
  const onFormError = useApiErrorHandler(form);

  const plansQuery = useQuery({
    queryKey: ['plans', page, pageSize],
    queryFn: () => listPlans({ page, pageSize }),
  });

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', 'options'],
    queryFn: () => listInbounds({ page: 1, pageSize: 100 }),
  });

  const inboundOptions = useMemo(
    () =>
      (inboundsQuery.data?.items ?? []).map((inbound) => ({
        value: inbound.id,
        label: `${inbound.tag} (${inbound.protocol})`,
      })),
    [inboundsQuery.data],
  );

  const saveMutation = useMutation({
    mutationFn: (values: PlanFormValues) => {
      const payload = {
        name: values.name,
        description: values.description,
        defaultDataLimitBytes: giBToBytes(values.defaultDataLimitGiB),
        defaultExpiryDays: values.defaultExpiryDays,
        defaultDeviceLimit: values.defaultDeviceLimit,
        defaultIpLimit: null,
        defaultSpeedLimitBps: mbpsToBps(values.defaultSpeedLimitMbps),
        defaultResetStrategy: values.defaultResetStrategy,
        inboundIds: values.inboundIds,
        subscriptionTitleTemplate: values.subscriptionTitleTemplate || null,
        subscriptionAnnounce: values.subscriptionAnnounce || null,
        subscriptionSupportUrl: values.subscriptionSupportUrl || null,
        subscriptionWebPageUrl: values.subscriptionWebPageUrl || null,
      };
      if (editingId) {
        return updatePlan(editingId, payload as never);
      }
      return createPlan(payload as never);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
    },
    onError: onFormError,
  });

  const archiveMutation = useMutation({
    mutationFn: archivePlan,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plans'] }),
    onError: onError,
  });

  const deleteMutation = useMutation({
    mutationFn: deletePlan,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plans'] }),
    onError: onError,
  });

  return (
    <div>
      <PageHeader
        title={t('plans.title')}
        extra={
          <MutateOnly>
            <Button
              type="primary"
              onClick={() => {
                setEditingId(null);
                form.resetFields();
                form.setFieldsValue({ defaultResetStrategy: 'NO_RESET', inboundIds: [] });
                setModalOpen(true);
              }}
            >
              {t('plans.create')}
            </Button>
          </MutateOnly>
        }
      />

      <Table
        size="small"
        rowKey="id"
        loading={plansQuery.isLoading}
        dataSource={plansQuery.data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: plansQuery.data?.pagination.total ?? 0,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        columns={[
          { title: t('plans.name'), dataIndex: 'name' },
          {
            title: t('app.status'),
            dataIndex: 'status',
            render: (status: string) => t(`enums.planStatus.${status}`, { defaultValue: status }),
          },
          {
            title: t('plans.defaults'),
            render: (_, row) =>
              `${row.defaultDataLimitBytes ? formatBytes(row.defaultDataLimitBytes) : t('app.unlimited')} · ${t(`enums.resetStrategy.${row.defaultResetStrategy}`, { defaultValue: row.defaultResetStrategy })}`,
          },
          { title: t('plans.userCount'), dataIndex: 'userCount' },
          {
            title: t('plans.inboundIds'),
            dataIndex: 'inboundIds',
            render: (ids: string[]) =>
              ids.length > 0 ? ids.length : <Tag color="orange">{t('plans.inboundsEmpty')}</Tag>,
          },
          {
            title: t('app.actions'),
            render: (_, row) => (
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => {
                    setEditingId(row.id);
                    form.setFieldsValue({
                      name: row.name,
                      description: row.description,
                      defaultDataLimitGiB: bytesToGiB(row.defaultDataLimitBytes),
                      defaultExpiryDays: row.defaultExpiryDays,
                      defaultDeviceLimit: row.defaultDeviceLimit,
                      defaultSpeedLimitMbps: bpsToMbps(row.defaultSpeedLimitBps),
                      defaultResetStrategy: row.defaultResetStrategy,
                      inboundIds: row.inboundIds,
                      subscriptionTitleTemplate: row.subscriptionTitleTemplate,
                      subscriptionAnnounce: row.subscriptionAnnounce,
                      subscriptionSupportUrl: row.subscriptionSupportUrl,
                      subscriptionWebPageUrl: row.subscriptionWebPageUrl,
                    });
                    setModalOpen(true);
                  }}
                >
                  {t('app.edit')}
                </Button>
                {canMutate && row.status === 'ACTIVE' ? (
                  <Popconfirm
                    title={t('plans.confirmArchive')}
                    onConfirm={() => archiveMutation.mutate(row.id)}
                  >
                    <Button size="small">{t('app.archive')}</Button>
                  </Popconfirm>
                ) : null}
                {canMutate ? (
                  <Popconfirm
                    title={t('plans.confirmDelete')}
                    onConfirm={() => deleteMutation.mutate(row.id)}
                  >
                    <Button size="small" danger>
                      {t('app.delete')}
                    </Button>
                  </Popconfirm>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={modalOpen}
        title={editingId ? t('plans.edit') : t('plans.create')}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label={t('plans.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('plans.description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="defaultDataLimitGiB"
            label={t('plans.trafficLimit')}
            extra={t('plans.trafficLimitHint')}
          >
            <InputNumber
              min={0}
              step={1}
              style={{ width: '100%' }}
              placeholder={t('app.unlimited')}
            />
          </Form.Item>
          <Form.Item name="defaultExpiryDays" label={t('app.days')}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="defaultDeviceLimit"
            label={t('users.deviceLimit')}
            extra={t('users.deviceLimitHint')}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="defaultSpeedLimitMbps"
            label={t('plans.speedLimit')}
            extra={t('plans.speedLimitHint')}
          >
            <InputNumber
              min={0}
              step={1}
              style={{ width: '100%' }}
              placeholder={t('app.unlimited')}
            />
          </Form.Item>
          <Form.Item name="defaultResetStrategy" label={t('users.resetStrategy')}>
            <Select
              options={['NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY'].map((value) => ({
                value,
                label: t(`enums.resetStrategy.${value}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="inboundIds"
            label={t('plans.inboundIds')}
            rules={[
              {
                required: true,
                type: 'array',
                min: 1,
                message: t('plans.inboundsRequired'),
              },
            ]}
            extra={t('plans.inboundsRequired')}
          >
            <Select mode="multiple" options={inboundOptions} />
          </Form.Item>
          {inboundOptions.length === 0 ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('plans.inboundsEmpty')}
              description={
                <Typography.Text>
                  {t('plans.inboundsRequired')} <Link to="/inbounds">{t('nav.inbounds')}</Link>
                </Typography.Text>
              }
            />
          ) : null}
          <Form.Item
            name="subscriptionTitleTemplate"
            label={t('plans.subscriptionTitleTemplate')}
            extra={t('plans.subscriptionTitleTemplateHint')}
          >
            <Input placeholder="{product} - {username}" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="subscriptionAnnounce"
            label={t('plans.subscriptionAnnounce')}
            extra={t('plans.subscriptionAnnounceHint')}
          >
            <Input.TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
          <Form.Item
            name="subscriptionSupportUrl"
            label={t('plans.subscriptionSupportUrl')}
            extra={t('plans.subscriptionSupportUrlHint')}
          >
            <Input placeholder="https://t.me/your_support" maxLength={2048} />
          </Form.Item>
          <Form.Item
            name="subscriptionWebPageUrl"
            label={t('plans.subscriptionWebPageUrl')}
            extra={t('plans.subscriptionWebPageUrlHint')}
          >
            <Input placeholder="https://example.com/info" maxLength={2048} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
