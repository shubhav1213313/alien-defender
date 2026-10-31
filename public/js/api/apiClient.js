// Small fetch wrapper for the game's REST API (frontend -> backend HTTP).
// Every response uses the shape { success, data | error }.
//
// CSRF: state-changing requests (POST/PATCH/PUT/DELETE) carry the
// X-CSRF-Token header. The token comes from GET /api/csrf-token, is
// replaced after login/registration (new session = new token), dropped at
// logout, and refreshed once automatically if the server rejects it (for
// example after the session timed out).
export class ApiError extends Error {
  constructor(message, status, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = no response (offline / timeout)
    this.code = code; // e.g. SESSION_EXPIRED, CSRF_INVALID, FORBIDDEN
    this.details = details; // per-field validation messages
  }
}

const SAFE_METHODS = ['GET', 'HEAD'];
let csrfToken = null;

async function send(path, { method = 'GET', body, timeoutMs = 12000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(err.name === 'AbortError' ? 'The game server did not respond in time.' : 'Cannot reach the game server.', 0);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response - handled below.
  }
  if (!response.ok || !payload || !payload.success) {
    throw new ApiError((payload && payload.error) || `Request failed (HTTP ${response.status})`, response.status,
      { code: payload && payload.code, details: payload && payload.details });
  }
  return payload.data;
}

async function getCsrfToken() {
  if (!csrfToken) csrfToken = (await send('/api/csrf-token')).csrfToken;
  return csrfToken;
}

export async function apiRequest(path, options = {}, isRetry = false) {
  const method = (options.method || 'GET').toUpperCase();
  if (SAFE_METHODS.includes(method)) return send(path, options);

  const headers = { 'X-CSRF-Token': await getCsrfToken() };
  try {
    const data = await send(path, { ...options, method, headers });
    if (data && data.csrfToken) csrfToken = data.csrfToken; // rotated at login/registration
    if (path === '/api/auth/logout') csrfToken = null; // session destroyed
    return data;
  } catch (err) {
    if (err.code === 'CSRF_INVALID' && !isRetry) {
      csrfToken = null;
      return apiRequest(path, options, true);
    }
    throw err;
  }
}
