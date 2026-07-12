import type {
  BulkUserActionRequest,
  CreateUser,
  UpdateUser,
  UserListQuery,
  UserResult,
  UserUsageSummary,
} from '@overvpn/shared/schemas';
import { apiRequest } from './client';

type OnlineSession = {
  id: string;
  sessionKey: string;
  inboundId: string;
  ipAddress: string | null;
  deviceId: string | null;
  connectedAt: string;
  lastSeenAt: string;
  disconnectedAt: string | null;
};

export type UserListResponse = {
  items: UserResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type BulkUserActionResponse = {
  action: string;
  affected: number;
  users: UserResult[];
};

export function listUsers(query: Partial<UserListQuery> = {}): Promise<UserListResponse> {
  return apiRequest<UserListResponse>('/admin/users', { query });
}

export function getUser(id: string): Promise<UserResult> {
  return apiRequest<UserResult>(`/admin/users/${id}`);
}

export function createUser(body: CreateUser): Promise<UserResult> {
  return apiRequest<UserResult>('/admin/users', { method: 'POST', body });
}

export function updateUser(id: string, body: UpdateUser): Promise<UserResult> {
  return apiRequest<UserResult>(`/admin/users/${id}`, { method: 'PATCH', body });
}

export function deleteUser(id: string): Promise<void> {
  return apiRequest<void>(`/admin/users/${id}`, { method: 'DELETE' });
}

export function bulkUserAction(body: BulkUserActionRequest): Promise<BulkUserActionResponse> {
  return apiRequest<BulkUserActionResponse>('/admin/users/bulk', {
    method: 'POST',
    body,
  });
}

export function rotateUserSub(id: string): Promise<UserResult> {
  return apiRequest<UserResult>(`/admin/users/${id}/rotate-sub`, {
    method: 'POST',
  });
}

export function resetUserTraffic(id: string): Promise<UserResult> {
  return apiRequest<UserResult>(`/admin/users/${id}/reset-traffic`, {
    method: 'POST',
  });
}

export function getUserUsage(
  id: string,
  query: { from?: string; to?: string } = {},
): Promise<UserUsageSummary> {
  return apiRequest<UserUsageSummary>(`/admin/users/${id}/usage`, { query });
}

export function getUserSessions(id: string): Promise<OnlineSession[]> {
  return apiRequest<OnlineSession[]>(`/admin/users/${id}/sessions`);
}
