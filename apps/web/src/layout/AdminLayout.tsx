import { Layout, Menu, Select, Button, Typography, Space, Spin } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  CloudServerOutlined,
  ProfileOutlined,
  WifiOutlined,
  DeploymentUnitOutlined,
  AuditOutlined,
  SettingOutlined,
  DatabaseOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PRODUCT_NAME } from '@overvpn/shared/constants';
import type { Locale } from '@overvpn/shared/constants';
import { useAuth } from '@/auth/AuthContext';
import { SupportButton } from '@/components/SupportButton';
import { useSetupProgress } from '@/hooks/useSetupProgress';
import { persistLocale } from '@/i18n';
import { useState } from 'react';

const { Header, Sider, Content } = Layout;

function LocaleLogoutBar() {
  const { t, i18n } = useTranslation();
  const { admin, logout, canMutate } = useAuth();
  const navigate = useNavigate();

  if (!admin) {
    return null;
  }

  return (
    <>
      <Typography.Text className="header-title">
        {admin.username}
        <Typography.Text type="secondary" style={{ marginLeft: 8, color: '#94a3b8' }}>
          {t(`enums.adminRole.${admin.role}`)}
          {!canMutate ? ` · ${t('app.readonlyHint')}` : ''}
        </Typography.Text>
      </Typography.Text>
      <Space>
        <Select
          size="small"
          value={i18n.language.startsWith('ru') ? 'ru' : 'en'}
          style={{ width: 88 }}
          options={[
            { value: 'ru', label: 'RU' },
            { value: 'en', label: 'EN' },
          ]}
          onChange={(locale: Locale) => {
            persistLocale(locale);
            void i18n.changeLanguage(locale);
          }}
        />
        <Button
          size="small"
          icon={<LogoutOutlined />}
          onClick={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
        >
          {t('app.logout')}
        </Button>
      </Space>
    </>
  );
}

export function AdminLayout() {
  const { t } = useTranslation();
  const { admin, bootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const setup = useSetupProgress();
  const isSetupRoute = location.pathname === '/setup' || location.pathname.startsWith('/setup/');

  if (bootstrapping) {
    return (
      <div className="app-center">
        <Spin size="large" tip={t('app.loading')} />
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (
    setup.shouldShowWizard &&
    !isSetupRoute &&
    !setup.isLoading
  ) {
    return <Navigate to="/setup" replace />;
  }

  if (isSetupRoute) {
    return (
      <Layout className="admin-shell setup-layout">
        <Header className="admin-header setup-header">
          <LocaleLogoutBar />
        </Header>
        <Content className="setup-content">
          <Outlet />
        </Content>
      </Layout>
    );
  }

  const selected = `/${location.pathname.split('/')[1] || 'dashboard'}`;

  const items = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('nav.dashboard') },
    { key: '/users', icon: <UserOutlined />, label: t('nav.users') },
    { key: '/inbounds', icon: <CloudServerOutlined />, label: t('nav.inbounds') },
    { key: '/plans', icon: <ProfileOutlined />, label: t('nav.plans') },
    { key: '/online', icon: <WifiOutlined />, label: t('nav.online') },
    { key: '/config', icon: <DeploymentUnitOutlined />, label: t('nav.config') },
    { key: '/audit', icon: <AuditOutlined />, label: t('nav.audit') },
    { key: '/system', icon: <SettingOutlined />, label: t('nav.system') },
    { key: '/backups', icon: <DatabaseOutlined />, label: t('nav.backups') },
  ];

  return (
    <Layout className="admin-shell">
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={220} theme="dark">
        <div className="brand-block">
          <img className="brand-mark" src="/logo.png" alt="" width={28} height={28} />
          {!collapsed ? <span className="brand-text">{PRODUCT_NAME}</span> : null}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected === '/' ? '/dashboard' : selected]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
        <SupportButton collapsed={collapsed} />
      </Sider>
      <Layout>
        <Header className="admin-header">
          <LocaleLogoutBar />
        </Header>
        <Content className="admin-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
