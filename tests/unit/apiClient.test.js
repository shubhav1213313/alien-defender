// Browser API client: CSRF token handling with a mocked fetch.
let apiRequest;

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// A fake server: issues tokens, checks them on unsafe requests.
function fakeServer() {
  const state = { token: 'tok-1', issued: 0, requests: [] };
  global.fetch = jest.fn(async (path, init) => {
    const headers = init.headers || {};
    state.requests.push({ path, method: init.method, csrf: headers['X-CSRF-Token'] });
    if (path === '/api/csrf-token') {
      state.issued += 1;
      return response(200, { success: true, data: { csrfToken: state.token } });
    }
    if (init.method !== 'GET' && headers['X-CSRF-Token'] !== state.token) {
      return response(403, { success: false, error: 'Invalid or missing CSRF token', code: 'CSRF_INVALID' });
    }
    if (path === '/api/auth/login') {
      state.token = 'tok-after-login';
      return response(200, { success: true, data: { user: { id: 1 }, csrfToken: state.token } });
    }
    return response(200, { success: true, data: { ok: true } });
  });
  return state;
}

beforeEach(async () => {
  jest.resetModules(); // fresh module = no cached token
  ({ apiRequest } = await import('../../public/js/api/apiClient.js'));
});

afterEach(() => { delete global.fetch; });

test('GET requests do not fetch or send a CSRF token', async () => {
  const server = fakeServer();
  await apiRequest('/api/leaderboard');
  expect(server.requests).toEqual([{ path: '/api/leaderboard', method: 'GET', csrf: undefined }]);
});

test('POST fetches a token once and sends it in X-CSRF-Token', async () => {
  const server = fakeServer();
  await apiRequest('/api/challenges', { method: 'POST', body: { wave: 1 } });
  await apiRequest('/api/challenges', { method: 'POST', body: { wave: 1 } });
  expect(server.issued).toBe(1);
  expect(server.requests.filter((r) => r.method === 'POST').map((r) => r.csrf)).toEqual(['tok-1', 'tok-1']);
});

test('the rotated token from login is used for later requests', async () => {
  const server = fakeServer();
  await apiRequest('/api/auth/login', { method: 'POST', body: {} });
  await apiRequest('/api/games', { method: 'POST', body: {} });
  expect(server.requests.at(-1).csrf).toBe('tok-after-login');
});

test('a rejected (stale) token is refreshed and the request retried once', async () => {
  const server = fakeServer();
  await apiRequest('/api/games', { method: 'POST', body: {} });
  server.token = 'tok-2'; // e.g. the session expired on the server
  await expect(apiRequest('/api/games', { method: 'POST', body: {} })).resolves.toEqual({ ok: true });
  expect(server.issued).toBe(2);
  expect(server.requests.at(-1).csrf).toBe('tok-2');
});

test('it does not retry forever', async () => {
  const server = fakeServer();
  global.fetch.mockImplementation(async (path) => (path === '/api/csrf-token'
    ? response(200, { success: true, data: { csrfToken: 'never-valid' } })
    : response(403, { success: false, error: 'Invalid or missing CSRF token', code: 'CSRF_INVALID' })));
  await expect(apiRequest('/api/games', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403, code: 'CSRF_INVALID' });
  expect(global.fetch).toHaveBeenCalledTimes(4); // token, POST, new token, POST
  expect(server).toBeDefined();
});

test('logout drops the token so the next request fetches a fresh one', async () => {
  const server = fakeServer();
  await apiRequest('/api/auth/logout', { method: 'POST' });
  await apiRequest('/api/challenges', { method: 'POST', body: {} });
  expect(server.issued).toBe(2);
});

test('network failure becomes ApiError status 0', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
  await expect(apiRequest('/api/leaderboard')).rejects.toMatchObject({ status: 0, message: 'Cannot reach the game server.' });
});
