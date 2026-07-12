import type {
  ConfigApplyRequest,
  ConfigPreviewResult,
  CoreApplyListQuery,
  CoreApplyRecordResult,
} from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export type CoreApplyListResponse = {
  items: CoreApplyRecordResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function previewConfig(): Promise<ConfigPreviewResult> {
  return apiRequest<ConfigPreviewResult>('/admin/config/preview');
}

export function applyConfig(body: ConfigApplyRequest): Promise<CoreApplyRecordResult> {
  return apiRequest<CoreApplyRecordResult>('/admin/config/apply', {
    method: 'POST',
    body,
  });
}

export function listApplies(
  query: Partial<CoreApplyListQuery> = {},
): Promise<CoreApplyListResponse> {
  return apiRequest<CoreApplyListResponse>('/admin/config/apply', { query });
}

export function getApply(id: string): Promise<CoreApplyRecordResult> {
  return apiRequest<CoreApplyRecordResult>(`/admin/config/apply/${id}`);
}

export function getRuntimeHealth(): Promise<unknown> {
  return apiRequest<unknown>('/admin/config/runtime/health');
}
