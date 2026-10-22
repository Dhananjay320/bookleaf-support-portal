/** Error thrown for non-2xx API responses, carrying the server's structured error. */
export class ApiRequestError extends Error {
  constructor(status, error) {
    super(error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = error?.code;
    this.details = error?.details ?? [];
  }

  /** Field-level validation messages keyed by field name. */
  fieldErrors() {
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

const BASE = '/api/v1';

/**
 * Thin fetch wrapper. Auth rides on the httpOnly session cookie, so no token
 * handling is needed in the browser.
 */
export async function api(path, { method = 'GET', body, query } = {}) {
  const qs = query
    ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null))}`
    : '';

  let res;
  try {
    res = await fetch(`${BASE}${path}${qs}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiRequestError(0, { code: 'NETWORK', message: 'Cannot reach the server. Check your connection.' });
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
      window.dispatchEvent(new Event('auth:expired'));
    }
    throw new ApiRequestError(res.status, data?.error);
  }
  return data;
}
