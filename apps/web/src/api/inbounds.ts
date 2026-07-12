import type {
  AddAssignment,
  AssignmentListQuery,
  AssignmentResult,
  CreateInbound,
  InboundLinkResult,
  InboundListQuery,
  InboundResult,
  RotateAssignmentCredential,
  UpdateInbound,
  CoreApplySummary,
} from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export type InboundListResponse = {
  items: InboundResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type AssignmentListResponse = {
  items: AssignmentResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type InboundMutationResult = {
  inbound: InboundResult | null;
  apply: CoreApplySummary;
};

export type AssignmentMutationResult = {
  assignment: AssignmentResult | null;
  apply: CoreApplySummary;
};

export function listInbounds(query: Partial<InboundListQuery> = {}): Promise<InboundListResponse> {
  return apiRequest<InboundListResponse>('/admin/inbounds', { query });
}

export function getInbound(id: string): Promise<InboundResult> {
  return apiRequest<InboundResult>(`/admin/inbounds/${id}`);
}

export function createInbound(body: CreateInbound): Promise<InboundMutationResult> {
  return apiRequest<InboundMutationResult>('/admin/inbounds', {
    method: 'POST',
    body,
  });
}

export function updateInbound(id: string, body: UpdateInbound): Promise<InboundMutationResult> {
  return apiRequest<InboundMutationResult>(`/admin/inbounds/${id}`, {
    method: 'PATCH',
    body,
  });
}

export function enableInbound(id: string): Promise<InboundMutationResult> {
  return apiRequest<InboundMutationResult>(`/admin/inbounds/${id}/enable`, {
    method: 'POST',
  });
}

export function disableInbound(id: string): Promise<InboundMutationResult> {
  return apiRequest<InboundMutationResult>(`/admin/inbounds/${id}/disable`, {
    method: 'POST',
  });
}

export function deleteInbound(id: string): Promise<InboundMutationResult> {
  return apiRequest<InboundMutationResult>(`/admin/inbounds/${id}`, {
    method: 'DELETE',
  });
}

export function listAssignments(
  inboundId: string,
  query: Partial<AssignmentListQuery> = {},
): Promise<AssignmentListResponse> {
  return apiRequest<AssignmentListResponse>(`/admin/inbounds/${inboundId}/assignments`, { query });
}

export function addAssignment(
  inboundId: string,
  body: AddAssignment,
): Promise<AssignmentMutationResult> {
  return apiRequest<AssignmentMutationResult>(`/admin/inbounds/${inboundId}/assignments`, {
    method: 'POST',
    body,
  });
}

export function removeAssignment(
  inboundId: string,
  assignmentId: string,
): Promise<AssignmentMutationResult> {
  return apiRequest<AssignmentMutationResult>(
    `/admin/inbounds/${inboundId}/assignments/${assignmentId}`,
    { method: 'DELETE' },
  );
}

export function rotateAssignmentCredential(
  inboundId: string,
  assignmentId: string,
  body: RotateAssignmentCredential = {},
): Promise<AssignmentMutationResult> {
  return apiRequest<AssignmentMutationResult>(
    `/admin/inbounds/${inboundId}/assignments/${assignmentId}/rotate`,
    { method: 'POST', body },
  );
}

export function revealAssignmentLink(
  inboundId: string,
  assignmentId: string,
): Promise<InboundLinkResult> {
  return apiRequest<InboundLinkResult>(
    `/admin/inbounds/${inboundId}/assignments/${assignmentId}/link`,
  );
}
