import type {
  AuthenticatedSession,
  LoginRequest,
  LoginResponse,
  AdminSummary,
  TotpConfirmRequest,
  TotpDisableRequest,
  TotpEnableRequest,
  TotpEnableResponse,
} from '@overvpn/shared/schemas';
import { apiRequest } from './client';

export function login(body: LoginRequest): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/admin/auth/login', {
    method: 'POST',
    body,
    auth: false,
  });
}

export function refresh(): Promise<AuthenticatedSession> {
  return apiRequest<AuthenticatedSession>('/admin/auth/refresh', {
    method: 'POST',
    body: {},
    auth: false,
    skipRefresh: true,
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>('/admin/auth/logout', {
    method: 'POST',
    body: {},
  });
}

export function me(): Promise<AdminSummary> {
  return apiRequest<AdminSummary>('/admin/auth/me');
}

export function enableTotp(body: TotpEnableRequest): Promise<TotpEnableResponse> {
  return apiRequest<TotpEnableResponse>('/admin/auth/totp/enable', {
    method: 'POST',
    body,
  });
}

export function confirmTotp(body: TotpConfirmRequest): Promise<void> {
  return apiRequest<void>('/admin/auth/totp/confirm', {
    method: 'POST',
    body,
  });
}

export function disableTotp(body: TotpDisableRequest): Promise<void> {
  return apiRequest<void>('/admin/auth/totp/disable', {
    method: 'DELETE',
    body,
  });
}
