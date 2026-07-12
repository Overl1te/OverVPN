import { errorEnvelopeSchema } from '@overvpn/shared/schemas';

export class ApiError extends Error {
  readonly code: string;
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
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.messageRu = options.messageRu;
    this.requestId = options.requestId;
    this.status = options.status;
    this.details = options.details;
  }

  localized(locale: string): string {
    return locale.startsWith('ru') ? this.messageRu || this.message : this.message;
  }
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
    return new ApiError({
      code: 'INTERNAL_ERROR',
      message: response.statusText || 'Request failed',
      messageRu: 'Ошибка запроса',
      requestId: requestIdHeader,
      status: response.status,
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
    });
  }

  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: 'Unexpected error response',
    messageRu: 'Неожиданный ответ об ошибке',
    requestId: requestIdHeader,
    status: response.status,
    details: payload,
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal, skipRefresh = false } = options;

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
      return apiRequest<T>(path, { ...options, skipRefresh: true });
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
  return JSON.parse(text) as T;
}

export async function apiDownload(
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
      return apiDownload(path, { ...options, skipRefresh: true });
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
