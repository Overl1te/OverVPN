import type {
  CreateProxyServer,
  ProxyDeleteResponse,
  ProxyDnsCheckRequest,
  ProxyDnsCheckResponse,
  ProxyInstallCommandResponse,
  ProxyServerListQuery,
  ProxyServerSummary,
  ProxyServerWizard,
  UpdateProxyServer,
} from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export type ProxyServerListResponse = {
  items: ProxyServerSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function listProxyServers(
  query: Partial<ProxyServerListQuery> = {},
): Promise<ProxyServerListResponse> {
  return apiRequest<ProxyServerListResponse>('/admin/proxy-servers', { query });
}

export function getProxyServer(id: string): Promise<ProxyServerSummary> {
  return apiRequest<ProxyServerSummary>(`/admin/proxy-servers/${id}`);
}

export function createProxyServer(body: CreateProxyServer): Promise<ProxyServerSummary> {
  return apiRequest<ProxyServerSummary>('/admin/proxy-servers', {
    method: 'POST',
    body,
  });
}

export function updateProxyServer(
  id: string,
  body: UpdateProxyServer,
): Promise<ProxyServerSummary> {
  return apiRequest<ProxyServerSummary>(`/admin/proxy-servers/${id}`, {
    method: 'PATCH',
    body,
  });
}

export function deleteProxyServer(id: string): Promise<ProxyDeleteResponse> {
  return apiRequest<ProxyDeleteResponse>(`/admin/proxy-servers/${id}`, {
    method: 'DELETE',
  });
}

export function disableProxyServer(id: string): Promise<ProxyServerSummary> {
  return apiRequest<ProxyServerSummary>(`/admin/proxy-servers/${id}/disable`, {
    method: 'POST',
  });
}

export function enableProxyServer(id: string): Promise<ProxyServerSummary> {
  return apiRequest<ProxyServerSummary>(`/admin/proxy-servers/${id}/enable`, {
    method: 'POST',
  });
}

export function createProxyInstallCommand(id: string): Promise<ProxyInstallCommandResponse> {
  return apiRequest<ProxyInstallCommandResponse>(`/admin/proxy-servers/${id}/install-command`, {
    method: 'POST',
  });
}

export function applyProxyServerWizard(
  id: string,
  body: ProxyServerWizard,
): Promise<ProxyServerSummary> {
  return apiRequest<ProxyServerSummary>(`/admin/proxy-servers/${id}/wizard`, {
    method: 'POST',
    body,
  });
}

export function checkProxyDns(body: ProxyDnsCheckRequest): Promise<ProxyDnsCheckResponse> {
  return apiRequest<ProxyDnsCheckResponse>('/admin/proxy-servers/dns-check', {
    method: 'POST',
    body,
  });
}
