/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import { AdminView } from '../../public/js/ui/AdminView.js';
import { AccountUI } from '../../public/js/ui/AccountUI.js';
import { Panels } from '../../public/js/ui/Panels.js';
import { EventBus } from '../../public/js/game/EventBus.js';

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const ADMIN = { id: 1, username: 'chief', role: 'admin', avatar: 'falcon', createdAt: '2026-10-31' };
const PLAYER = { ...ADMIN, id: 2, username: 'pilot', role: 'player' };

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
});

test('the Admin Dashboard button is shown only to admins', () => {
  const account = new AccountUI({ api: jest.fn(), bus: new EventBus(), panels: new Panels(document), root: document });
  const button = document.querySelector('[data-panel="admin"]');
  expect(button.hidden).toBe(true); // hidden by default in the HTML
  account.setUser(PLAYER);
  expect(button.hidden).toBe(true);
  account.setUser(ADMIN);
  expect(button.hidden).toBe(false);
  account.setUser(null);
  expect(button.hidden).toBe(true);
});

function adminApi() {
  return jest.fn(async (url, { method = 'GET' } = {}) => {
    if (url === '/api/admin/overview') {
      return { counts: { users: 2, admins: 1, gamesFinished: 5, gamesLast24h: 3, arenasPlayed: 4, puzzlesSolved: 11, trophiesUnlocked: 6 },
        apis: { banana: { source: 'banana', latencyMs: 300, error: null }, quotes: { source: null } } };
    }
    if (url === '/api/admin/users') {
      return [{ ...ADMIN, email: 'c@x.io', gamesPlayed: 1, bestScore: 900 }, { ...PLAYER, email: 'p@x.io', gamesPlayed: 4, bestScore: 5000 }];
    }
    if (url === '/api/admin/scores') return [{ id: 9, username: 'pilot', difficulty: 'hard', outcome: 'victory', score: 5000, durationSeconds: 600 }];
    if (method === 'PATCH' || method === 'DELETE') return {};
    throw new Error(`unexpected ${method} ${url}`);
  });
}

test('renders counts, API status, users and scores; no role button for yourself', async () => {
  const api = adminApi();
  const view = new AdminView({ container: document.querySelector('[data-admin-body]'), account: { user: ADMIN }, api });
  await view.load();
  const body = document.querySelector('[data-admin-body]');
  expect(body.textContent).toContain('Puzzles solved');
  expect(body.textContent).toContain('Banana: 300 ms');
  expect(body.textContent).toContain('ZenQuotes: not used yet');
  const rows = [...body.querySelectorAll('tbody tr')];
  expect(rows[0].textContent).toContain('(you)');
  expect(rows[1].querySelector('button').textContent).toBe('Make admin');
});

test('role change and score removal call the admin API', async () => {
  const api = adminApi();
  window.confirm = jest.fn(() => true);
  const view = new AdminView({ container: document.querySelector('[data-admin-body]'), account: { user: ADMIN }, api });
  await view.load();
  await view.changeRole({ id: 2, username: 'pilot' }, 'admin');
  expect(api).toHaveBeenCalledWith('/api/admin/users/2/role', { method: 'PATCH', body: { role: 'admin' } });
  await view.deleteScore({ id: 9, username: 'pilot', score: 5000 });
  expect(api).toHaveBeenCalledWith('/api/admin/scores/9', { method: 'DELETE' });
});

test('a 403 from the server is shown, not hidden', async () => {
  const api = jest.fn(async () => { throw Object.assign(new Error('You do not have permission to do that'), { status: 403 }); });
  const view = new AdminView({ container: document.querySelector('[data-admin-body]'), account: { user: PLAYER, sessionExpired: jest.fn() }, api });
  await view.load();
  expect(document.querySelector('[data-admin-body]').textContent).toBe('You do not have permission to do that');
});
