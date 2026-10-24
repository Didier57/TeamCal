let csrfToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public details?: unknown
  ) {
    super(code);
  }
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken && options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const body = data && typeof data === 'object' ? (data as { error?: unknown; details?: unknown }) : null;
    const error = body && 'error' in body ? String(body.error) : `http_${response.status}`;
    throw new ApiError(error, response.status, body?.details);
  }
  return data as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPatch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export async function apiUpload<T>(path: string, body: Blob): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers,
    body,
    credentials: 'same-origin'
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const payload = data && typeof data === 'object' ? (data as { error?: unknown; details?: unknown }) : null;
    const error = payload && 'error' in payload ? String(payload.error) : `http_${response.status}`;
    throw new ApiError(error, response.status, payload?.details);
  }
  return data as T;
}
