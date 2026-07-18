import { Button, Form, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { archivePlan, createPlan, deletePlan, listPlans, updatePlan } from '@/api/plans';
import { listInbounds } from '@/api/inbounds';
import { PageHeader } from '@/components/PageHeader';
import { MutateOnly } from '@/components/MutateOnly';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { TOUR_ASSIST_EVENT, type TourAssistDetail } from '@/hooks/usePanelTour';
import { formatBytes } from '@/utils/format';
import { PlanFormFields } from './plans/PlanFormFields';
import {
  bpsToMbps,
  bytesToGiB,
  defaultPlanFormValues,
  planFormValuesToPayload,
  type PlanFormValues,
} from './plans/planFormUtils';

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

  useEffect(() => {
    const onAssist = (event: Event) => {
      const detail = (event as CustomEvent<TourAssistDetail>).detail;
      if (detail?.action !== 'create-plan' || !canMutate) {
        return;
      }
      setEditingId(null);
      form.resetFields();
      form.setFieldsValue({ ...defaultPlanFormValues });
      setModalOpen(true);
    };
    window.addEventListener(TOUR_ASSIST_EVENT, onAssist);
    return () => window.removeEventListener(TOUR_ASSIST_EVENT, onAssist);
  }, [canMutate, form]);

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
      const payload = planFormValuesToPayload(values);
      if (editingId) {
        return updatePlan(editingId, payload as never);
      }
      return createPlan(payload as never);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
    },
    onError: onError,
  });

  return (
    <div>
      <PageHeader
        title={<span data-tour="page-plans">{t('plans.title')}</span>}
        extra={
          <MutateOnly>
            <Button
              type="primary"
              data-tour="create-plan"
              onClick={() => {
                setEditingId(null);
                form.resetFields();
                form.setFieldsValue({ ...defaultPlanFormValues });
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
                      subscriptionShowTrafficLimits: row.subscriptionShowTrafficLimits,
                      happProviderId: row.happProviderId,
                      subscriptionSubInfoText: row.subscriptionSubInfoText,
                      subscriptionSubInfoColor: row.subscriptionSubInfoColor,
                      subscriptionSubInfoButtonText: row.subscriptionSubInfoButtonText,
                      subscriptionSubInfoButtonLink: row.subscriptionSubInfoButtonLink,
                      subscriptionSubExpireEnabled: row.subscriptionSubExpireEnabled,
                      subscriptionSubExpireButtonLink: row.subscriptionSubExpireButtonLink,
                      subscriptionFallbackUrlTemplate: row.subscriptionFallbackUrlTemplate,
                      subscriptionColorProfile: row.subscriptionColorProfile,
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
        width={720}
      >
        <PlanFormFields
          form={form}
          inboundOptions={inboundOptions}
          onFinish={(values) => saveMutation.mutate(values)}
        />
      </Modal>
    </div>
  );
}
