import type {
  GlobalUsage,
  SystemDashboard,
  SystemEngines,
  SystemHealth,
  SystemHostStats,
  SystemUpdateStatus,
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

export function getSystemEngines(): Promise<SystemEngines> {
  return apiRequest<SystemEngines>('/admin/system/engines');
}

export function getHostStats(): Promise<SystemHostStats> {
  return apiRequest<SystemHostStats>('/admin/system/host');
}

export function getUpdateStatus(): Promise<SystemUpdateStatus> {
  return apiRequest<SystemUpdateStatus>('/admin/system/updates');
}

export function checkForUpdates(): Promise<SystemUpdateStatus> {
  return apiRequest<SystemUpdateStatus>('/admin/system/updates/check', {
    method: 'POST',
  });
}

export function getGlobalUsage(
  query: {
    from?: string;
    to?: string;
  } = {},
): Promise<GlobalUsage> {
  return apiRequest<GlobalUsage>('/admin/system/usage', { query });
}
