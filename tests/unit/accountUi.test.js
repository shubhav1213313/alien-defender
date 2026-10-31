/**
 * @jest-environment jsdom
 */
// Account, panels, profile/leaderboard and score saving in a simulated
// browser, using the REAL public/index.html. The API is mocked.
import fs from 'fs';
import path from 'path';
import { AccountUI } from '../../public/js/ui/AccountUI.js';
import { Panels } from '../../public/js/ui/Panels.js';
import { GameRecorder } from '../../public/js/ui/GameRecorder.js';
import { ProfileView, LeaderboardView } from '../../public/js/ui/PlayerViews.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { ApiError } from '../../public/js/api/apiClient.js';

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const USER = { id: 1, username: 'ace_pilot', email: 'ace@example.com', role: 'player', avatar: 'nova', createdAt: '2026-10-31T10:00:00Z' };
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(routes = {}) {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const calls = [];
  const api = jest.fn(async (url, { method = 'GET', body } = {}) => {
    calls.push({ method, url, body });
    const handler = routes[`${method} ${url.split('?')[0]}`];
    if (!handler) throw new Error(`unmocked ${method} ${url}`);
    return handler(body);
  });
  const bus = new EventBus();
  const panels = new Panels(document);
  const account = new AccountUI({ api, bus, panels, root: document });
  return { api, calls, bus, panels, account };
}

async function fill(form, values) {
  for (const [name, value] of Object.entries(values)) form.querySelector(`[name="${name}"]`).value = value;
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
}

describe('AccountUI', () => {
  test('a guest sees "Log in" and the guest-only menu button', async () => {
    const { account } = setup({ 'GET /api/auth/me': () => ({ user: null }) });
    await account.restore();
    expect(document.getElementById('account-bar').textContent).toContain('Log in');
    expect(document.querySelector('[data-panel="profile"]').hidden).toBe(true);
    expect(document.querySelector('[data-panel="auth"]').hidden).toBe(false);
    expect(document.getElementById('menu-welcome').textContent).toMatch(/guest/);
  });

  test('a returning player is restored from the server session', async () => {
    const { account } = setup({ 'GET /api/auth/me': () => ({ user: USER }) });
    await account.restore();
    expect(document.getElementById('account-bar').textContent).toContain('ace_pilot');
    expect(document.querySelector('[data-panel="profile"]').hidden).toBe(false);
  });

  test('login form posts credentials, closes the panel and shows the pilot', async () => {
    const { account, panels, calls } = setup({ 'POST /api/auth/login': () => ({ user: USER }) });
    panels.open('auth');
    await fill(document.getElementById('form-login'), { identifier: 'ace_pilot', password: 'Secret123' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/auth/login', body: { identifier: 'ace_pilot', password: 'Secret123' } });
    expect(account.user).toEqual(USER);
    expect(document.getElementById('panel-auth').hidden).toBe(true);
    expect(document.getElementById('form-login').querySelector('[name="password"]').value).toBe('');
  });

  test('registration errors from the server appear next to each field', async () => {
    const { panels, account } = setup({
      'POST /api/auth/register': () => { throw new ApiError('Please fix the highlighted fields', 400, { details: { username: 'That username is already taken' } }); },
    });
    panels.open('auth');
    account.showTab('register');
    await fill(document.getElementById('form-register'), { username: 'ace_pilot', email: 'a@b.co', password: 'Secret123' });
    expect(document.querySelector('[data-field-error="username"]').textContent).toBe('That username is already taken');
    expect(document.getElementById('panel-auth').hidden).toBe(false);
    expect(account.user).toBeNull();
  });

  test('usernames are rendered as text, never as HTML', async () => {
    const { account } = setup({ 'GET /api/auth/me': () => ({ user: { ...USER, username: '<img src=x onerror=alert(1)>' } }) });
    await account.restore();
    expect(document.querySelector('#account-bar img')).toBeNull();
    expect(document.getElementById('account-bar').textContent).toContain('<img');
  });

  test('logout clears the user', async () => {
    const { account } = setup({ 'GET /api/auth/me': () => ({ user: USER }), 'POST /api/auth/logout': () => ({ loggedOut: true }) });
    await account.restore();
    await account.logout();
    expect(account.user).toBeNull();
  });
});

describe('GameRecorder', () => {
  const summary = {
    reason: 'victory', score: 50000, wave: 5, wavesCleared: 5, enemiesDestroyed: 90, maxCombo: 20,
    shotsFired: 2000, shotsHit: 900, abilitiesUsed: 4, bossDefeated: true, difficulty: 'hard',
    arenaCorrect: 99, arenaQuestions: 99,
  };

  function recorderFor(user, routes) {
    const ctx = setup(routes);
    ctx.account.user = user;
    const engine = { bus: ctx.bus, summary: (reason) => ({ ...summary, reason }) };
    const recorder = new GameRecorder({ engine, account: ctx.account, api: ctx.api, root: document });
    return { ...ctx, recorder };
  }

  test('logged-in game: start + result are sent, trophies shown', async () => {
    const { bus, calls, recorder } = recorderFor(USER, {
      'POST /api/games': () => ({ gameSessionId: 42 }),
      'POST /api/games/42/result': () => ({ personalBest: true, newAchievements: [{ id: 'boss_slayer', name: 'Boss Slayer', icon: '🛸' }] }),
    });
    bus.emit('game:start', { difficulty: 'hard' });
    await flush();
    expect(recorder.gameSessionId).toBe(42);
    bus.emit('game:victory', summary);
    await flush();
    const sent = calls.find((c) => c.url === '/api/games/42/result').body;
    expect(sent).toEqual({ outcome: 'victory', score: 50000, waveReached: 5, wavesCleared: 5, enemiesDestroyed: 90, maxCombo: 20, shotsFired: 2000, shotsHit: 900, abilitiesUsed: 4, bossDefeated: true });
    expect(sent).not.toHaveProperty('arenaCorrect'); // the server counts arena answers itself
    const status = document.querySelector('#screen-victory [data-save-status]').textContent;
    expect(status).toContain('new personal best');
    expect(status).toContain('Boss Slayer');
  });

  test('quitting a paused game saves it as abandoned', async () => {
    const { bus, calls } = recorderFor(USER, {
      'POST /api/games': () => ({ gameSessionId: 7 }),
      'POST /api/games/7/result': () => ({ personalBest: false, newAchievements: [] }),
    });
    bus.emit('game:start', { difficulty: 'easy' });
    await flush();
    bus.emit('state:change', { from: 'paused', to: 'menu' });
    await flush();
    expect(calls.find((c) => c.url === '/api/games/7/result').body.outcome).toBe('abandoned');
  });

  test('guests make no API calls and are invited to log in', async () => {
    const { bus, calls } = recorderFor(null, {});
    bus.emit('game:start', { difficulty: 'normal' });
    bus.emit('game:over', { ...summary, reason: 'destroyed' });
    await flush();
    expect(calls).toHaveLength(0);
    expect(document.querySelector('#screen-gameover [data-save-status]').textContent).toMatch(/guest/);
  });

  test('an expired session logs the player out and explains the score was not saved', async () => {
    const { bus, account } = recorderFor(USER, {
      'POST /api/games': () => ({ gameSessionId: 9 }),
      'POST /api/games/9/result': () => { throw new ApiError('Your session expired after 15 minutes of inactivity.', 401, { code: 'SESSION_EXPIRED' }); },
    });
    bus.emit('game:start', { difficulty: 'normal' });
    await flush();
    bus.emit('game:over', { ...summary, reason: 'destroyed' });
    await flush();
    expect(account.user).toBeNull();
    expect(document.querySelector('#screen-gameover [data-save-status]').textContent).toMatch(/not saved.*15 minutes/);
  });
});

describe('Profile and leaderboard views', () => {
  test('profile renders stats, trophies (locked and unlocked) and recent games', async () => {
    const { account, api } = setup({
      'GET /api/profile': () => ({
        stats: { gamesPlayed: 3, highScore: 12000, enemiesDestroyed: 150, bossVictories: 1, arenaCorrect: 9, arenaQuestions: 12, quizAccuracy: 75, accuracy: 41, bestCombo: 18 },
        recentScores: [{ createdAt: '2026-10-31T10:00:00Z', difficulty: 'hard', outcome: 'victory', score: 12000, waveReached: 5, arenaCorrect: 4, arenaQuestions: 4 }],
        achievements: [
          { id: 'first_blood', name: 'First Blood', description: 'd', icon: '🎯', unlocked: true, unlockedAt: '2026-10-31T10:00:00Z' },
          { id: 'boss_slayer', name: 'Boss Slayer', description: 'Destroy the Mothership.', icon: '🛸', unlocked: false, unlockedAt: null },
        ],
      }),
    });
    account.user = USER;
    const view = new ProfileView({ container: document.querySelector('[data-profile-body]'), account, api });
    await view.load();
    const body = document.querySelector('[data-profile-body]');
    expect(body.textContent).toContain('12,000');
    expect(body.textContent).toContain('75% (9/12)');
    expect(body.querySelectorAll('.trophy.unlocked')).toHaveLength(1);
    expect(body.querySelector('.trophy.locked').textContent).toContain('🔒');
    expect(body.querySelector('.data-table').textContent).toContain('Victory');
  });

  test('leaderboard highlights the current player and switches difficulty', async () => {
    const rows = [{ rank: 1, username: 'rival', score: 9000, difficulty: 'hard', waveReached: 5, bossDefeated: true, createdAt: '2026-10-31' },
      { rank: 2, username: 'ace_pilot', score: 5000, difficulty: 'normal', waveReached: 3, bossDefeated: false, createdAt: '2026-10-31' }];
    const { account, api, calls } = setup({ 'GET /api/leaderboard': () => rows });
    account.user = USER;
    const view = new LeaderboardView({ container: document.querySelector('[data-leaderboard-body]'), tabs: [...document.querySelectorAll('[data-board]')], account, api });
    await view.load();
    expect(document.querySelector('[data-leaderboard-body] tr.me').textContent).toContain('ace_pilot');
    document.querySelector('[data-board="hard"]').click();
    await flush();
    expect(calls.at(-1).url).toBe('/api/leaderboard?difficulty=hard&limit=10');
  });
});
