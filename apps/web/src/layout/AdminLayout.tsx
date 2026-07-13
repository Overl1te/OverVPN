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
import { persistLocale } from '@/i18n';
import { useState } from 'react';

const { Header, Sider, Content } = Layout;

export function AdminLayout() {
  const { t, i18n } = useTranslation();
  const { admin, bootstrapping, logout, canMutate } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

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
      </Sider>
      <Layout>
        <Header className="admin-header">
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
        </Header>
        <Content className="admin-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
