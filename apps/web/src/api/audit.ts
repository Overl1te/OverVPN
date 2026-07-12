import type { AuditListQuery } from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export type AuditLogItem = {
  id: string;
  actorAdminId: string | null;
  actorUsername: string | null;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE';
  resourceType: string | null;
  resourceId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  details: unknown;
  createdAt: string;
};

export type AuditListResponse = {
  items: AuditLogItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function listAuditLogs(query: Partial<AuditListQuery> = {}): Promise<AuditListResponse> {
  return apiRequest<AuditListResponse>('/admin/audit', { query });
}
