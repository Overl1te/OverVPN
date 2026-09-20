import {
  ERROR_CATALOG,
  errorCatalogEntry,
  errorDocsUrl,
  type ErrorCode,
} from '@overvpn/shared/constants';
import { errorEnvelopeSchema } from '@overvpn/shared/schemas';
import { SUPPORT_MANIFEST } from '@overvpn/shared/support-integrity';
import { getPanelSupportProof, isSupportPresent } from '@/components/SupportButton';

export class ApiError extends Error {
  readonly code: string;
  readonly id: string;
  readonly docsUrl: string;
  readonly messageRu: string;
  readonly requestId: string | null;
  readonly status: number;
  readonly details: unknown;

  constructor(options: {
    code: string;
    message: string;
    messageRu: string;
    requestId: string | null;
    status: number;
    details?: unknown;
    id?: string;
    docsUrl?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    const catalog = errorCatalogEntry(options.code);
    this.id = options.id ?? catalog.id;
    this.docsUrl = options.docsUrl ?? errorDocsUrl(this.id);
    this.messageRu = options.messageRu;
    this.requestId = options.requestId;
    this.status = options.status;
    this.details = options.details;
  }

  localized(locale: string): string {
    return locale.startsWith('ru') ? this.messageRu || this.message : this.message;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'ApiError' &&
      typeof (error as { code?: unknown }).code === 'string')
  );
}

export function apiErrorFromCatalog(
  code: ErrorCode,
  options: {
    status: number;
    requestId?: string | null;
    details?: unknown;
    message?: string;
    messageRu?: string;
  },
): ApiError {
  const entry = ERROR_CATALOG[code];
  return new ApiError({
    code,
    id: entry.id,
    docsUrl: errorDocsUrl(entry.id),
    message: options.message ?? entry.title.en,
    messageRu: options.messageRu ?? entry.title.ru,
    requestId: options.requestId ?? null,
    status: options.status,
    details: options.details,
  });
}

export function normalizeApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    if (error instanceof ApiError) {
      return error;
    }
    const like = error as ApiError;
    return new ApiError({
      code: like.code,
      message: like.message,
      messageRu: like.messageRu,
      requestId: like.requestId ?? null,
      status: typeof like.status === 'number' ? like.status : 0,
      details: like.details,
      id: like.id,
      docsUrl: like.docsUrl,
    });
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    throw error;
  }
  if (error instanceof Error && error.message === 'SUPPORT_INTEGRITY_FAILED') {
    return apiErrorFromCatalog('SUPPORT_INTEGRITY_FAILED', { status: 503 });
  }
  if (error instanceof TypeError) {
    return apiErrorFromCatalog('NETWORK_ERROR', { status: 0, details: error.message });
  }
  return apiErrorFromCatalog('UNKNOWN_ERROR', {
    status: 0,
    details: error instanceof Error ? error.message : error,
  });
}

type TokenAccessor = {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  clearSession: () => void;
};

let tokenAccessor: TokenAccessor | null = null;

export function configureApiClient(accessor: TokenAccessor): void {
  tokenAccessor = accessor;
}

export type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: boolean;
  signal?: AbortSignal;
  /** Skip the single automatic refresh retry (used by refresh itself). */
  skipRefresh?: boolean;
};

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`/api${normalized}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function parseError(response: Response): Promise<ApiError> {
  const requestIdHeader = response.headers.get('x-request-id');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return apiErrorFromCatalog('UNEXPECTED_ERROR_RESPONSE', {
      status: response.status,
      requestId: requestIdHeader,
      details: response.statusText,
    });
  }

  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    return new ApiError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      messageRu: parsed.data.error.messageRu,
      requestId: parsed.data.requestId || requestIdHeader,
      status: response.status,
      details: parsed.data.error.details,
      id: parsed.data.error.id,
      docsUrl: parsed.data.error.docsUrl,
    });
  }

  return apiErrorFromCatalog('UNEXPECTED_ERROR_RESPONSE', {
    status: response.status,
    requestId: requestIdHeader,
    details: payload,
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await apiRequestInner<T>(path, options);
  } catch (error) {
    throw normalizeApiError(error);
  }
}

async function apiRequestInner<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal, skipRefresh = false } = options;
  const upperMethod = method.toUpperCase();
  const isMutation = upperMethod !== 'GET' && upperMethod !== 'HEAD' && upperMethod !== 'OPTIONS';

  const headers = new Headers();
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = tokenAccessor?.getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  if (auth && isMutation) {
    if (!isSupportPresent()) {
      throw apiErrorFromCatalog('SUPPORT_INTEGRITY_FAILED', { status: 503 });
    }
    headers.set(SUPPORT_MANIFEST.headerName, await getPanelSupportProof());
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
    signal,
  });

  if (response.status === 401 && auth && !skipRefresh && tokenAccessor) {
    const refreshed = await tokenAccessor.refreshAccessToken();
    if (refreshed) {
      return apiRequestInner<T>(path, { ...options, skipRefresh: true });
    }
    tokenAccessor.clearSession();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw apiErrorFromCatalog('UNEXPECTED_ERROR_RESPONSE', { status: response.status });
  }
}

export async function apiDownload(
  path: string,
  options: Omit<RequestOptions, 'body'> = {},
): Promise<{ blob: Blob; filename: string | null }> {
  try {
    return await apiDownloadInner(path, options);
  } catch (error) {
    throw normalizeApiError(error);
  }
}

async function apiDownloadInner(
  path: string,
  options: Omit<RequestOptions, 'body'> = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const { query, auth = true, signal, skipRefresh = false } = options;
  const headers = new Headers();
  if (auth) {
    const token = tokenAccessor?.getAccessToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(buildUrl(path, query), {
    method: 'GET',
    headers,
    credentials: 'include',
    signal,
  });

  if (response.status === 401 && auth && !skipRefresh && tokenAccessor) {
    const refreshed = await tokenAccessor.refreshAccessToken();
    if (refreshed) {
      return apiDownloadInner(path, { ...options, skipRefresh: true });
    }
    tokenAccessor.clearSession();
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  const disposition = response.headers.get('content-disposition');
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return {
    blob: await response.blob(),
    filename: match?.[1] ?? null,
  };
}
