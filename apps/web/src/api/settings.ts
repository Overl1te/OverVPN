import type { SystemSettings, UpdateSystemSettings } from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export function getSettings(): Promise<SystemSettings> {
  return apiRequest<SystemSettings>('/admin/settings');
}

export function updateSettings(body: UpdateSystemSettings): Promise<SystemSettings> {
  return apiRequest<SystemSettings>('/admin/settings', {
    method: 'PATCH',
    body,
  });
}
