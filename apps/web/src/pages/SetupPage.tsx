import { Alert, Button, Form, Input, Progress, Select, Space, Steps, Typography } from 'antd';
import {
  CloudServerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  LinkOutlined,
  ProfileOutlined,
  SettingOutlined,
  UserOutlined,
  WifiOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { InboundResult } from '@overvpn/shared/schemas';
import type { UserResult } from '@overvpn/shared/schemas';
import { createPlan, listPlans } from '@/api/plans';
import { listInbounds } from '@/api/inbounds';
import { createUser } from '@/api/users';
import { getSettings } from '@/api/settings';
import { CopyButton } from '@/components/CopyButton';
import { PageHeader } from '@/components/PageHeader';
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

type GuidePhase = 'overview' | 'inbound' | 'plan' | 'user' | 'done';

type UserFormValues = {
  username: string;
  planId: string;
};

const PHASE_TO_STEP: Record<Exclude<GuidePhase, 'overview'>, number> = {
  inbound: 0,
  plan: 1,
  user: 2,
  done: 3,
};

function ModelFlow({
  labels,
}: {
  labels: { inbound: string; plan: string; user: string; sub: string };
}) {
  const nodes = [
    { key: 'inbound', label: labels.inbound, icon: <CloudServerOutlined /> },
    { key: 'plan', label: labels.plan, icon: <ProfileOutlined /> },
    { key: 'user', label: labels.user, icon: <UserOutlined /> },
    { key: 'sub', label: labels.sub, icon: <LinkOutlined /> },
  ];

  return (
    <div className="setup-guide-flow" aria-hidden={false}>
      {nodes.map((node, index) => (
        <div key={node.key} className="setup-guide-flow-item">
          <div className="setup-guide-flow-node">
            <span className="setup-guide-flow-icon">{node.icon}</span>
            <span>{node.label}</span>
          </div>
          {index < nodes.length - 1 ? (
            <ArrowRightOutlined className="setup-guide-flow-arrow" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function NavMapCard({
  icon,
  title,
  body,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div className={`setup-guide-nav-card${highlight ? ' setup-guide-nav-card--highlight' : ''}`}>
      <div className="setup-guide-nav-card-title">
        <span className="setup-guide-nav-card-icon">{icon}</span>
        <Typography.Text strong>{title}</Typography.Text>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
        {body}
      </Typography.Paragraph>
    </div>
  );
}

function StepShell({
  whereLater,
  openSectionLabel,
  openSectionTo,
  onOpenSection,
  children,
}: {
  whereLater: string;
  openSectionLabel: string;
  openSectionTo: string;
  onOpenSection: () => void;
  children: ReactNode;
}) {
  return (
    <div className="setup-guide-step">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={whereLater}
        action={
          <Link
            to={openSectionTo}
            onClick={() => {
              onOpenSection();
            }}
          >
            <Button size="small">{openSectionLabel}</Button>
          </Link>
        }
      />
      {children}
    </div>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { admin } = useAuth();
  const setup = useSetupProgress();
  const [phase, setPhase] = useState<GuidePhase>('overview');
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
    if (setup.isLoading || stepInitialized || phase === 'overview') {
      return;
    }
    const firstIncomplete = setup.steps.findIndex((step) => !step.done);
    if (firstIncomplete === 0) {
      setPhase('inbound');
    } else if (firstIncomplete === 1) {
      setPhase('plan');
    } else if (firstIncomplete === 2) {
      setPhase('user');
    }
    setStepInitialized(true);
  }, [setup.isLoading, setup.steps, stepInitialized, phase]);

  useEffect(() => {
    if (!inboundsQuery.isSuccess || phase !== 'inbound') {
      return;
    }
    const existing = inboundsQuery.data.items;
    if (existing.length === 0) {
      return;
    }
    if (!createdInboundId) {
      setCreatedInboundId(existing[0]!.id);
    }
  }, [createdInboundId, phase, inboundsQuery.data, inboundsQuery.isSuccess]);

  useEffect(() => {
    if (phase === 'plan') {
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
  }, [phase, createdInboundId, inboundsQuery.data, inboundOptions, planForm, t]);

  useEffect(() => {
    if (phase === 'user') {
      const preferredPlan =
        createdPlanId ?? plansQuery.data?.items.find((p) => p.status === 'ACTIVE')?.id;
      if (preferredPlan) {
        userForm.setFieldsValue({ planId: preferredPlan });
      }
    }
  }, [phase, createdPlanId, plansQuery.data, userForm]);

  const planMutation = useMutation({
    mutationFn: (values: PlanFormValues) => createPlan(planFormValuesToPayload(values) as never),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['setup'] });
      setCreatedPlanId(plan.id);
      setPhase('user');
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
      setPhase('done');
    },
    onError: onUserError,
  });

  if (admin?.role !== 'OWNER') {
    return <Navigate to="/dashboard" replace />;
  }

  if (!setup.isLoading && setup.complete && phase !== 'done' && !createdUser) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSkip = () => {
    setup.dismissWizard();
    navigate('/dashboard', { replace: true });
  };

  const leaveGuideToSection = () => {
    setup.dismissWizard();
  };

  const handleStart = () => {
    const firstIncomplete = setup.steps.findIndex((step) => !step.done);
    if (firstIncomplete <= 0) {
      setPhase('inbound');
    } else if (firstIncomplete === 1) {
      setPhase('plan');
    } else if (firstIncomplete === 2) {
      setPhase('user');
    } else {
      setPhase('done');
    }
    setStepInitialized(true);
  };

  const handleInboundSaved = (inbound: InboundResult) => {
    setCreatedInboundId(inbound.id);
    setInboundEditorOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    void queryClient.invalidateQueries({ queryKey: ['setup'] });
    setPhase('plan');
  };

  const stepItems = [
    { title: t('setup.stepInbound') },
    { title: t('setup.stepPlan') },
    { title: t('setup.stepUser') },
    { title: t('setup.stepDone') },
  ];

  const currentStep = phase === 'overview' ? -1 : PHASE_TO_STEP[phase];

  const skipButton = <Button onClick={handleSkip}>{t('setup.skipGuide')}</Button>;

  if (phase === 'overview') {
    return (
      <div className="setup-guide">
        <PageHeader title={t('setup.guideTitle')} extra={skipButton} />
        <Typography.Paragraph type="secondary" className="setup-guide-lead">
          {t('setup.guideSubtitle')}
        </Typography.Paragraph>

        <section className="setup-guide-section">
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t('setup.modelTitle')}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{t('setup.modelBody')}</Typography.Paragraph>
          <ModelFlow
            labels={{
              inbound: t('setup.stepInbound'),
              plan: t('setup.stepPlan'),
              user: t('setup.stepUser'),
              sub: t('setup.modelSub'),
            }}
          />
        </section>

        <section className="setup-guide-section">
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t('setup.navMapTitle')}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{t('setup.navMapBody')}</Typography.Paragraph>
          <div className="setup-guide-nav-grid">
            <NavMapCard
              icon={<DashboardOutlined />}
              title={t('nav.dashboard')}
              body={t('setup.navDashboard')}
            />
            <NavMapCard
              icon={<CloudServerOutlined />}
              title={t('nav.inbounds')}
              body={t('setup.navInbounds')}
              highlight
            />
            <NavMapCard
              icon={<ProfileOutlined />}
              title={t('nav.plans')}
              body={t('setup.navPlans')}
              highlight
            />
            <NavMapCard
              icon={<UserOutlined />}
              title={t('nav.users')}
              body={t('setup.navUsers')}
              highlight
            />
            <NavMapCard
              icon={<WifiOutlined />}
              title={t('nav.online')}
              body={t('setup.navOnline')}
            />
            <NavMapCard
              icon={<DeploymentUnitOutlined />}
              title={t('nav.config')}
              body={t('setup.navConfig')}
            />
            <NavMapCard
              icon={<SettingOutlined />}
              title={t('nav.system')}
              body={t('setup.navSystem')}
            />
            <NavMapCard
              icon={<DatabaseOutlined />}
              title={t('nav.backups')}
              body={t('setup.navBackups')}
            />
          </div>
        </section>

        <div className="setup-guide-cta">
          <Button type="primary" size="large" onClick={handleStart}>
            {t('setup.startGuide')}
          </Button>
          <Button size="large" onClick={handleSkip}>
            {t('setup.goToPanel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-guide">
      <PageHeader
        title={t('setup.guideTitle')}
        extra={
          phase !== 'done' ? (
            skipButton
          ) : (
            <Button type="primary" onClick={() => navigate('/dashboard', { replace: true })}>
              {t('setup.goToPanel')}
            </Button>
          )
        }
      />

      <Progress
        percent={Math.round((setup.doneCount / setup.totalSteps) * 100)}
        format={() => `${setup.doneCount}/${setup.totalSteps}`}
        style={{ marginBottom: 16 }}
      />

      <Steps
        current={currentStep}
        items={stepItems}
        style={{ marginBottom: 24 }}
        responsive
        size="small"
      />

      {phase === 'inbound' ? (
        <StepShell
          whereLater={t('setup.whereInbound')}
          openSectionLabel={t('setup.openSection', { section: t('nav.inbounds') })}
          openSectionTo="/inbounds"
          onOpenSection={leaveGuideToSection}
        >
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
              <Button type="primary" onClick={() => setPhase('plan')}>
                {t('setup.continue')}
              </Button>
            ) : null}
            <Button onClick={() => setPhase('overview')}>{t('app.back')}</Button>
          </Space>
        </StepShell>
      ) : null}

      {phase === 'plan' ? (
        <StepShell
          whereLater={t('setup.wherePlan')}
          openSectionLabel={t('setup.openSection', { section: t('nav.plans') })}
          openSectionTo="/plans"
          onOpenSection={leaveGuideToSection}
        >
          <Typography.Paragraph>{t('setup.planBody')}</Typography.Paragraph>
          {setup.steps[1]?.done && !createdPlanId ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('setup.planDone')}
              action={
                <Button size="small" type="link" onClick={() => setPhase('user')}>
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
          <Space style={{ marginTop: 8 }} wrap>
            <Button onClick={() => setPhase('inbound')}>{t('app.back')}</Button>
            <Button
              type="primary"
              loading={planMutation.isPending}
              onClick={() => planForm.submit()}
            >
              {t('setup.saveAndContinue')}
            </Button>
            {setup.steps[1]?.done ? (
              <Button onClick={() => setPhase('user')}>{t('setup.skipCreate')}</Button>
            ) : null}
          </Space>
        </StepShell>
      ) : null}

      {phase === 'user' ? (
        <StepShell
          whereLater={t('setup.whereUser')}
          openSectionLabel={t('setup.openSection', { section: t('nav.users') })}
          openSectionTo="/users"
          onOpenSection={leaveGuideToSection}
        >
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
          <Space wrap>
            <Button onClick={() => setPhase('plan')}>{t('app.back')}</Button>
            <Button
              type="primary"
              loading={userMutation.isPending}
              disabled={planOptions.length === 0}
              onClick={() => userForm.submit()}
            >
              {t('setup.saveAndContinue')}
            </Button>
          </Space>
        </StepShell>
      ) : null}

      {phase === 'done' ? (
        <div className="setup-guide-step">
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('setup.doneTitle')}
            description={t('setup.doneBody')}
          />
          <Typography.Paragraph type="secondary">{t('setup.whereDone')}</Typography.Paragraph>
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
        </div>
      ) : null}

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
