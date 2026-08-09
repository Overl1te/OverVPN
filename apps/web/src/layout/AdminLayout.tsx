import { Layout, Menu, Select, Button, Typography, Space, Spin } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  CloudServerOutlined,
  ClusterOutlined,
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
import { PanelTour } from '@/components/PanelTour';
import { usePanelTour } from '@/hooks/usePanelTour';
import { persistLocale } from '@/i18n';
import { useEffect, useState, type ReactNode } from 'react';

const { Header, Sider, Content } = Layout;

function NavLabel({ tourId, children }: { tourId: string; children: ReactNode }) {
  return <span data-tour={tourId}>{children}</span>;
}

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
  const panelTour = usePanelTour();

  useEffect(() => {
    if (panelTour.shouldAutoStart) {
      setCollapsed(false);
    }
  }, [panelTour.shouldAutoStart]);

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

  const selected = `/${location.pathname.split('/')[1] || 'dashboard'}`;

  const items = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: <NavLabel tourId="nav-dashboard">{t('nav.dashboard')}</NavLabel>,
    },
    {
      key: '/users',
      icon: <UserOutlined />,
      label: <NavLabel tourId="nav-users">{t('nav.users')}</NavLabel>,
    },
    {
      key: '/proxy',
      icon: <ClusterOutlined />,
      label: <NavLabel tourId="nav-proxy">{t('nav.proxy')}</NavLabel>,
    },
    {
      key: '/inbounds',
      icon: <CloudServerOutlined />,
      label: <NavLabel tourId="nav-inbounds">{t('nav.inbounds')}</NavLabel>,
    },
    {
      key: '/plans',
      icon: <ProfileOutlined />,
      label: <NavLabel tourId="nav-plans">{t('nav.plans')}</NavLabel>,
    },
    {
      key: '/online',
      icon: <WifiOutlined />,
      label: <NavLabel tourId="nav-online">{t('nav.online')}</NavLabel>,
    },
    {
      key: '/config',
      icon: <DeploymentUnitOutlined />,
      label: <NavLabel tourId="nav-config">{t('nav.config')}</NavLabel>,
    },
    {
      key: '/audit',
      icon: <AuditOutlined />,
      label: <NavLabel tourId="nav-audit">{t('nav.audit')}</NavLabel>,
    },
    {
      key: '/system',
      icon: <SettingOutlined />,
      label: <NavLabel tourId="nav-system">{t('nav.system')}</NavLabel>,
    },
    {
      key: '/backups',
      icon: <DatabaseOutlined />,
      label: <NavLabel tourId="nav-backups">{t('nav.backups')}</NavLabel>,
    },
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
          selectedKeys={[selected === '/' || selected === '/setup' ? '/dashboard' : selected]}
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
      <PanelTour />
    </Layout>
  );
}
