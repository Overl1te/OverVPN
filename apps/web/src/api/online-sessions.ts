import type { OnlineSessionListQuery, OnlineSessionListResponse } from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export function listOnlineSessions(
  query: Partial<OnlineSessionListQuery> = {},
): Promise<OnlineSessionListResponse> {
  return apiRequest<OnlineSessionListResponse>('/admin/online-sessions', {
    query,
  });
}
