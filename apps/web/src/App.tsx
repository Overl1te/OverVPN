import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '@/layout/AdminLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { UsersListPage } from '@/pages/users/UsersListPage';
import { UserDetailPage } from '@/pages/users/UserDetailPage';
import { InboundsListPage } from '@/pages/inbounds/InboundsListPage';
import { ProxyServersListPage } from '@/pages/proxy/ProxyServersListPage';
import { ProxyCreateWizardPage } from '@/pages/proxy/ProxyCreateWizardPage';
import { ProxyServerDetailPage } from '@/pages/proxy/ProxyServerDetailPage';
import { PlansPage } from '@/pages/PlansPage';
import { OnlineSessionsPage } from '@/pages/OnlineSessionsPage';
import { ConfigPage } from '@/pages/ConfigPage';
import { AuditPage } from '@/pages/AuditPage';
import { SystemPage } from '@/pages/SystemPage';
import { BackupsPage } from '@/pages/BackupsPage';
import { SetupPage } from '@/pages/SetupPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="users" element={<UsersListPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="proxy" element={<ProxyServersListPage />} />
        <Route path="proxy/new" element={<ProxyCreateWizardPage />} />
        <Route path="proxy/:id" element={<ProxyServerDetailPage />} />
        <Route path="inbounds" element={<InboundsListPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="online" element={<OnlineSessionsPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="backups" element={<BackupsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
