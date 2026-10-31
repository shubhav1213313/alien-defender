// Small fetch wrapper for the game's REST API (frontend -> backend HTTP).
// Every response uses the shape { success, data | error }.
export class ApiError extends Error {
  constructor(message, status, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = no response (offline / timeout)
    this.code = code; // e.g. SESSION_EXPIRED
    this.details = details; // per-field validation messages
  }
}

export async function apiRequest(path, { method = 'GET', body, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
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
