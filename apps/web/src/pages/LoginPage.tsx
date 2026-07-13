import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '@overvpn/shared/constants';
import { useAuth } from '@/auth/AuthContext';
import { ApiError } from '@/api/client';
import { useApiErrorHandler } from '@/hooks/useApiError';

type FormValues = {
  username: string;
  password: string;
  totpCode?: string;
};

export function LoginPage() {
  const { t } = useTranslation();
  const { login, admin, bootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onError = useApiErrorHandler();
  const [totpRequired, setTotpRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  if (bootstrapping) {
    return null;
  }
  if (admin) {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  return (
    <div className="login-shell">
      <Card className="login-card" bordered={false}>
        <div className="login-brand">
          <img src="/logo.png" alt="" width={48} height={48} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            {PRODUCT_NAME}
          </Typography.Title>
        </div>
        <Typography.Paragraph type="secondary">{t('auth.loginTitle')}</Typography.Paragraph>
        {totpRequired ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={t('auth.totpRequired')}
          />
        ) : null}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              const status = await login({
                username: values.username,
                password: values.password,
                totpCode: values.totpCode || undefined,
                returnRefreshToken: false,
              });
              if (status === 'TOTP_REQUIRED') {
                setTotpRequired(true);
                return;
              }
              const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
              navigate(from, { replace: true });
            } catch (error) {
              if (error instanceof ApiError && error.code === 'AUTH_TOTP_REQUIRED') {
                setTotpRequired(true);
                return;
              }
              onError(error);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item
            name="username"
            label={t('auth.username')}
            rules={[{ required: true, min: 3 }]}
          >
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label={t('auth.password')} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          {totpRequired ? (
            <Form.Item
              name="totpCode"
              label={t('auth.totpCode')}
              rules={[{ required: true, pattern: /^\d{6}$/ }]}
            >
              <Input inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
            </Form.Item>
          ) : null}
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {submitting ? t('auth.signingIn') : t('auth.submit')}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
