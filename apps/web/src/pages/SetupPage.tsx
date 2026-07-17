import { Alert, Button, Card, Form, Input, Progress, Select, Space, Steps, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { InboundResult } from '@overvpn/shared/schemas';
import type { UserResult } from '@overvpn/shared/schemas';
import { createPlan, listPlans } from '@/api/plans';
import { listInbounds } from '@/api/inbounds';
import { createUser } from '@/api/users';
import { getSettings } from '@/api/settings';
import { CopyButton } from '@/components/CopyButton';
import { QrModal } from '@/components/QrModal';
import { useAuth } from '@/auth/AuthContext';
import { useApiErrorHandler } from '@/hooks/useApiError';
import { useSetupProgress } from '@/hooks/useSetupProgress';
import { buildSubscriptionUrl } from '@/utils/format';
import { InboundEditor } from '@/pages/inbounds/InboundEditor';
import { PlanFormFields } from '@/pages/plans/PlanFormFields';
import {
  defaultPlanFormValues,
  planFormValuesToPayload,
  type PlanFormValues,
} from '@/pages/plans/planFormUtils';

type UserFormValues = {
  username: string;
  planId: string;
};

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { admin } = useAuth();
  const setup = useSetupProgress();
  const [current, setCurrent] = useState(0);
  const [stepInitialized, setStepInitialized] = useState(false);
  const [createdInboundId, setCreatedInboundId] = useState<string | null>(null);
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<UserResult | null>(null);
  const [inboundEditorOpen, setInboundEditorOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [planForm] = Form.useForm<PlanFormValues>();
  const [userForm] = Form.useForm<UserFormValues>();
  const onPlanError = useApiErrorHandler(planForm);
  const onUserError = useApiErrorHandler(userForm);

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', 'setup-options'],
    queryFn: () => listInbounds({ page: 1, pageSize: 100 }),
    enabled: admin?.role === 'OWNER',
  });

  const plansQuery = useQuery({
    queryKey: ['plans', 'setup-options'],
    queryFn: () => listPlans({ page: 1, pageSize: 100, status: 'ACTIVE' }),
    enabled: admin?.role === 'OWNER',
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    enabled: !!createdUser,
  });

  const inboundOptions = useMemo(
    () =>
      (inboundsQuery.data?.items ?? []).map((inbound) => ({
        value: inbound.id,
        label: `${inbound.tag} (${inbound.protocol})`,
      })),
    [inboundsQuery.data],
  );

  const planOptions = useMemo(
    () =>
      (plansQuery.data?.items ?? []).map((plan) => ({
        value: plan.id,
        label: plan.name,
      })),
    [plansQuery.data],
  );

  const subUrl =
    createdUser && settingsQuery.data?.subPublicBaseUrl
      ? buildSubscriptionUrl(createdUser.subToken, settingsQuery.data.subPublicBaseUrl)
      : '';

  useEffect(() => {
    if (setup.isLoading || stepInitialized) {
      return;
    }
    const firstIncomplete = setup.steps.findIndex((step) => !step.done);
    setCurrent(firstIncomplete >= 0 ? firstIncomplete : 0);
    setStepInitialized(true);
  }, [setup.isLoading, setup.steps, stepInitialized]);

  useEffect(() => {
    if (!inboundsQuery.isSuccess || current !== 0) {
      return;
    }
    const existing = inboundsQuery.data.items;
    if (existing.length === 0) {
      return;
    }
    if (!createdInboundId) {
      setCreatedInboundId(existing[0]!.id);
    }
    if (!setup.steps[0]?.done) {
      setCurrent(1);
    }
  }, [
    createdInboundId,
    current,
    inboundsQuery.data,
    inboundsQuery.isSuccess,
    setup.steps,
  ]);

  useEffect(() => {
    if (current === 1) {
      const preferredInbound =
        createdInboundId ??
        inboundsQuery.data?.items[0]?.id ??
        (inboundOptions[0]?.value as string | undefined);
      planForm.setFieldsValue({
        ...defaultPlanFormValues,
        name: planForm.getFieldValue('name') || t('setup.defaultPlanName'),
        inboundIds: preferredInbound ? [preferredInbound] : [],
      });
    }
  }, [current, createdInboundId, inboundsQuery.data, inboundOptions, planForm, t]);

  useEffect(() => {
    if (current === 2) {
      const preferredPlan =
        createdPlanId ?? plansQuery.data?.items.find((p) => p.status === 'ACTIVE')?.id;
      if (preferredPlan) {
        userForm.setFieldsValue({ planId: preferredPlan });
      }
    }
  }, [current, createdPlanId, plansQuery.data, userForm]);

  const planMutation = useMutation({
    mutationFn: (values: PlanFormValues) => createPlan(planFormValuesToPayload(values) as never),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
      setCreatedPlanId(plan.id);
      setCurrent(2);
    },
    onError: onPlanError,
  });

  const userMutation = useMutation({
    mutationFn: (values: UserFormValues) =>
      createUser({
        username: values.username,
        planId: values.planId,
        status: 'ACTIVE',
      } as never),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
      setCreatedUser(user);
      setCurrent(3);
    },
    onError: onUserError,
  });

  if (admin?.role !== 'OWNER') {
    return <Navigate to="/dashboard" replace />;
  }

  if (!setup.isLoading && setup.complete && current !== 3 && !createdUser) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSkip = () => {
    setup.dismissWizard();
    navigate('/dashboard', { replace: true });
  };

  const handleInboundSaved = (inbound: InboundResult) => {
    setCreatedInboundId(inbound.id);
    setInboundEditorOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    void queryClient.invalidateQueries({ queryKey: ['setup'] });
    setCurrent(1);
  };

  const stepItems = [
    { title: t('setup.stepInbound') },
    { title: t('setup.stepPlan') },
    { title: t('setup.stepUser') },
    { title: t('setup.stepDone') },
  ];

  return (
    <div className="setup-shell">
      <div className="setup-card">
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          {t('setup.title')}
        </Typography.Title>
        <Typography.Paragraph type="secondary">{t('setup.subtitle')}</Typography.Paragraph>

        <Progress
          percent={Math.round((setup.doneCount / setup.totalSteps) * 100)}
          format={() => `${setup.doneCount}/${setup.totalSteps}`}
          style={{ marginBottom: 24 }}
        />

        <Steps current={current} items={stepItems} style={{ marginBottom: 32 }} />

        {current === 0 ? (
          <Card size="small">
            <Typography.Paragraph>{t('setup.inboundBody')}</Typography.Paragraph>
            {setup.steps[0]?.done ? (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('setup.inboundDone')}
              />
            ) : null}
            <Space wrap>
              <Button type="primary" onClick={() => setInboundEditorOpen(true)}>
                {setup.steps[0]?.done ? t('setup.createAnotherInbound') : t('setup.createInbound')}
              </Button>
              {setup.steps[0]?.done ? (
                <Button type="primary" onClick={() => setCurrent(1)}>
                  {t('setup.continue')}
                </Button>
              ) : null}
            </Space>
          </Card>
        ) : null}

        {current === 1 ? (
          <Card size="small">
            <Typography.Paragraph>{t('setup.planBody')}</Typography.Paragraph>
            {setup.steps[1]?.done && !createdPlanId ? (
              <Alert
                type="success"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('setup.planDone')}
                action={
                  <Button size="small" type="link" onClick={() => setCurrent(2)}>
                    {t('setup.continue')}
                  </Button>
                }
              />
            ) : null}
            <PlanFormFields
              form={planForm}
              inboundOptions={inboundOptions}
              showInboundEmptyLink={false}
              onFinish={(values) => planMutation.mutate(values)}
            />
            <Space style={{ marginTop: 8 }}>
              <Button onClick={() => setCurrent(0)}>{t('app.back')}</Button>
              <Button
                type="primary"
                loading={planMutation.isPending}
                onClick={() => planForm.submit()}
              >
                {t('setup.saveAndContinue')}
              </Button>
              {setup.steps[1]?.done ? (
                <Button onClick={() => setCurrent(2)}>{t('setup.skipCreate')}</Button>
              ) : null}
            </Space>
          </Card>
        ) : null}

        {current === 2 ? (
          <Card size="small">
            <Typography.Paragraph>{t('setup.userBody')}</Typography.Paragraph>
            {planOptions.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={t('users.noActivePlans')}
              />
            ) : null}
            <Form
              form={userForm}
              layout="vertical"
              onFinish={(values) => userMutation.mutate(values)}
            >
              <Form.Item name="username" label={t('users.username')} rules={[{ required: true }]}>
                <Input autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="planId"
                label={t('users.plan')}
                rules={[{ required: true, message: t('users.planRequired') }]}
              >
                <Select options={planOptions} placeholder={t('users.plan')} />
              </Form.Item>
            </Form>
            <Space>
              <Button onClick={() => setCurrent(1)}>{t('app.back')}</Button>
              <Button
                type="primary"
                loading={userMutation.isPending}
                disabled={planOptions.length === 0}
                onClick={() => userForm.submit()}
              >
                {t('setup.saveAndContinue')}
              </Button>
            </Space>
          </Card>
        ) : null}

        {current === 3 ? (
          <Card size="small">
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('setup.doneTitle')}
              description={t('setup.doneBody')}
            />
            {createdUser ? (
              <>
                <Typography.Text type="secondary">{t('users.subscription')}</Typography.Text>
                {subUrl ? (
                  <Typography.Paragraph
                    copyable={{ text: subUrl }}
                    style={{ wordBreak: 'break-all', marginTop: 8 }}
                  >
                    {subUrl}
                  </Typography.Paragraph>
                ) : (
                  <Typography.Paragraph type="secondary">
                    {t('users.subscriptionLoading')}
                  </Typography.Paragraph>
                )}
                <Space wrap style={{ marginBottom: 16 }}>
                  {subUrl ? <CopyButton value={subUrl} size="middle" /> : null}
                  <Button disabled={!subUrl} onClick={() => setQrOpen(true)}>
                    {t('app.showQr')}
                  </Button>
                  <Link to={`/users/${createdUser.id}`}>{t('setup.openUser')}</Link>
                </Space>
              </>
            ) : null}
            <Button
              type="primary"
              size="large"
              onClick={() => navigate('/dashboard', { replace: true })}
            >
              {t('setup.goToPanel')}
            </Button>
          </Card>
        ) : null}

        {current < 3 ? (
          <div style={{ marginTop: 24 }}>
            <Button type="link" onClick={handleSkip}>
              {t('setup.skipLater')}
            </Button>
          </div>
        ) : null}
      </div>

      <InboundEditor
        open={inboundEditorOpen}
        inbound={null}
        onClose={() => setInboundEditorOpen(false)}
        onSaved={handleInboundSaved}
      />
      <QrModal open={qrOpen} value={subUrl} onClose={() => setQrOpen(false)} />
    </div>
  );
}
