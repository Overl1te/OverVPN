import type { CreatePlan, PlanListQuery, PlanResult, UpdatePlan } from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export type PlanListResponse = {
  items: PlanResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function listPlans(query: Partial<PlanListQuery> = {}): Promise<PlanListResponse> {
  return apiRequest<PlanListResponse>('/admin/plans', { query });
}

export function getPlan(id: string): Promise<PlanResult> {
  return apiRequest<PlanResult>(`/admin/plans/${id}`);
}

export function createPlan(body: CreatePlan): Promise<PlanResult> {
  return apiRequest<PlanResult>('/admin/plans', { method: 'POST', body });
}

export function updatePlan(id: string, body: UpdatePlan): Promise<PlanResult> {
  return apiRequest<PlanResult>(`/admin/plans/${id}`, { method: 'PATCH', body });
}

export function archivePlan(id: string): Promise<PlanResult> {
  return apiRequest<PlanResult>(`/admin/plans/${id}/archive`, { method: 'POST' });
}

export function deletePlan(id: string): Promise<void> {
  return apiRequest<void>(`/admin/plans/${id}`, { method: 'DELETE' });
}
