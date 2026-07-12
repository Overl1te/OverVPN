import type {
  BackupArtifactResult,
  BackupListQuery,
  CreateBackupRequest,
  RestoreBackupRequest,
} from '@overvpn/shared/schemas';
import { apiDownload, apiRequest } from './client';

export type BackupListResponse = {
  items: BackupArtifactResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function listBackups(query: Partial<BackupListQuery> = {}): Promise<BackupListResponse> {
  return apiRequest<BackupListResponse>('/admin/backups', { query });
}

export function getBackup(id: string): Promise<BackupArtifactResult> {
  return apiRequest<BackupArtifactResult>(`/admin/backups/${id}`);
}

export function createBackup(body: CreateBackupRequest): Promise<BackupArtifactResult> {
  return apiRequest<BackupArtifactResult>('/admin/backups', {
    method: 'POST',
    body,
  });
}

export function restoreBackup(
  id: string,
  body: RestoreBackupRequest,
): Promise<BackupArtifactResult> {
  return apiRequest<BackupArtifactResult>(`/admin/backups/${id}/restore`, {
    method: 'POST',
    body,
  });
}

export function deleteBackup(id: string): Promise<BackupArtifactResult> {
  return apiRequest<BackupArtifactResult>(`/admin/backups/${id}`, {
    method: 'DELETE',
  });
}

export async function downloadBackup(id: string): Promise<void> {
  const { blob, filename } = await apiDownload(`/admin/backups/${id}/download`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `backup-${id}.bin`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
