import { apiRequest } from '../api/apiClient.js';
import { el, formatDate } from './dom.js';

// Admin dashboard. Only shown to admins - but that is a convenience: every
// request below is checked again on the server (401/403), so hiding or
// showing this panel grants nothing.
export class AdminView {
  constructor({ container, account, api = apiRequest }) {
    this.container = container;
    this.account = account;
    this.api = api;
  }

  async load() {
    this.container.replaceChildren(el('p', { class: 'arena-loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading dashboard…'));
    try {
      const [overview, users, scores] = await Promise.all([
        this.api('/api/admin/overview'),
        this.api('/api/admin/users'),
        this.api('/api/admin/scores'),
      ]);
      this.render(overview, users, scores);
    } catch (err) {
      if (err.status === 401) this.account.sessionExpired(err.message);
      this.container.replaceChildren(el('p', { class: 'form-error' }, err.message));
    }
  }

  render({ counts, apis }, users, scores) {
    const stat = (label, value) => el('div', { class: 'stat' }, el('strong', {}, value), el('span', {}, label));
    const api = (name, s) => (!s || !s.source ? `${name}: not used yet` : s.error ? `${name}: ${s.error}` : `${name}: ${s.latencyMs} ms`);
    this.message = el('p', { class: 'arena-note', 'aria-live': 'polite' });

    this.container.replaceChildren(
      el('div', { class: 'stats-grid' },
        stat('Players', counts.users), stat('Admins', counts.admins), stat('Games finished', counts.gamesFinished),
        stat('Games (24 h)', counts.gamesLast24h), stat('Arenas played', counts.arenasPlayed),
        stat('Puzzles solved', counts.puzzlesSolved), stat('Trophies unlocked', counts.trophiesUnlocked)),
      el('p', { class: 'arena-note' }, `External APIs - ${api('Banana', apis.banana)} · ${api('ZenQuotes', apis.quotes)}`),
      this.message,
      el('h3', {}, 'Players'),
      el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {}, ['Pilot', 'Email', 'Role', 'Games', 'Best', 'Joined', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, users.map((u) => el('tr', {},
          el('td', {}, u.username), el('td', {}, u.email), el('td', {}, u.role),
          el('td', {}, u.gamesPlayed), el('td', {}, u.bestScore.toLocaleString()), el('td', {}, formatDate(u.createdAt)),
          el('td', {}, u.id === this.account.user.id ? '(you)' : el('button', {
            class: 'btn small', type: 'button',
            onclick: () => this.changeRole(u, u.role === 'admin' ? 'player' : 'admin'),
          }, u.role === 'admin' ? 'Make player' : 'Make admin')))))),
      el('h3', {}, 'Recent scores'),
      scores.length
        ? el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {}, ['Pilot', 'Difficulty', 'Result', 'Score', 'Time', ''].map((h) => el('th', {}, h)))),
          el('tbody', {}, scores.map((s) => el('tr', {},
            el('td', {}, s.username), el('td', {}, s.difficulty), el('td', {}, s.outcome),
            el('td', {}, s.score.toLocaleString()), el('td', {}, `${Math.round(s.durationSeconds / 60)} min`),
            el('td', {}, el('button', { class: 'btn small', type: 'button', onclick: () => this.deleteScore(s) }, 'Remove'))))))
        : el('p', { class: 'arena-note' }, 'No scores yet.'),
    );
  }

  async changeRole(user, role) {
    try {
      await this.api(`/api/admin/users/${user.id}/role`, { method: 'PATCH', body: { role } });
      await this.load();
      this.message.textContent = `${user.username} is now ${role === 'admin' ? 'an admin' : 'a player'}.`;
    } catch (err) {
      this.message.textContent = err.message;
    }
  }

  async deleteScore(score) {
    if (!window.confirm(`Remove ${score.username}'s score of ${score.score}? This cannot be undone.`)) return;
    try {
      await this.api(`/api/admin/scores/${score.id}`, { method: 'DELETE' });
      await this.load();
      this.message.textContent = 'Score removed from the leaderboard.';
    } catch (err) {
      this.message.textContent = err.message;
    }
  }
}
