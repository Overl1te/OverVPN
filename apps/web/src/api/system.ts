import type {
  GlobalUsage,
  SystemDashboard,
  SystemHealth,
  SystemHostStats,
} from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export function getDashboard(
  query: {
    from?: string;
    to?: string;
  } = {},
): Promise<SystemDashboard> {
  return apiRequest<SystemDashboard>('/admin/system/dashboard', { query });
}

export function getSystemHealth(): Promise<SystemHealth> {
  return apiRequest<SystemHealth>('/admin/system/health');
}

export function getHostStats(): Promise<SystemHostStats> {
  return apiRequest<SystemHostStats>('/admin/system/host');
}

export function getGlobalUsage(
  query: {
    from?: string;
    to?: string;
  } = {},
): Promise<GlobalUsage> {
  return apiRequest<GlobalUsage>('/admin/system/usage', { query });
}
