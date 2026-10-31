import { apiRequest } from '../api/apiClient.js';
import { el, formatDate } from './dom.js';

const DIFFICULTY_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const OUTCOME_LABEL = { victory: 'Victory', destroyed: 'Ship destroyed', earthFallen: 'Earth fell', abandoned: 'Abandoned' };

function loading(text) {
  return el('p', { class: 'arena-loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

// Profile page: lifetime statistics, trophy showcase and recent games.
export class ProfileView {
  constructor({ container, account, api = apiRequest }) {
    this.container = container;
    this.account = account;
    this.api = api;
  }

  async load() {
    this.container.replaceChildren(loading('Loading profile…'));
    try {
      const data = await this.api('/api/profile');
      this.render(data);
    } catch (err) {
      if (err.status === 401) this.account.sessionExpired(err.message);
      this.container.replaceChildren(el('p', { class: 'form-error' }, err.message));
    }
  }

  render({ stats, recentScores, achievements }) {
    const { user } = this.account;
    const unlocked = achievements.filter((a) => a.unlocked).length;
    const stat = (label, value) => el('div', { class: 'stat' }, el('strong', {}, value), el('span', {}, label));

    this.container.replaceChildren(
      el('p', { class: 'profile-head' }, `🚀 ${user.username} · ${user.avatar} · ${user.role} · pilot since ${formatDate(user.createdAt)}`),
      el('div', { class: 'stats-grid' },
        stat('Games played', stats.gamesPlayed),
        stat('High score', stats.highScore.toLocaleString()),
        stat('Aliens destroyed', stats.enemiesDestroyed.toLocaleString()),
        stat('Boss victories', stats.bossVictories),
        stat('Quiz accuracy', `${stats.quizAccuracy}% (${stats.arenaCorrect}/${stats.arenaQuestions})`),
        stat('Shot accuracy', `${stats.accuracy}%`),
        stat('Best combo', stats.bestCombo),
        stat('Trophies', `${unlocked}/${achievements.length}`)),
      el('h3', {}, 'Trophy showcase'),
      el('ul', { class: 'trophies' }, achievements.map((a) => el('li', { class: a.unlocked ? 'trophy unlocked' : 'trophy locked', title: a.description },
        el('span', { class: 'icon', 'aria-hidden': 'true' }, a.unlocked ? a.icon : '🔒'),
        el('strong', {}, a.name),
        el('small', {}, a.unlocked ? `Unlocked ${formatDate(a.unlockedAt)}` : a.description)))),
      el('h3', {}, 'Recent games'),
      recentScores.length
        ? el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {}, ['Date', 'Difficulty', 'Result', 'Score', 'Wave', 'Puzzles'].map((h) => el('th', {}, h)))),
          el('tbody', {}, recentScores.map((s) => el('tr', {},
            el('td', {}, formatDate(s.createdAt)),
            el('td', {}, DIFFICULTY_LABEL[s.difficulty]),
            el('td', {}, OUTCOME_LABEL[s.outcome] || s.outcome),
            el('td', {}, s.score.toLocaleString()),
            el('td', {}, s.waveReached),
            el('td', {}, `${s.arenaCorrect}/${s.arenaQuestions}`)))))
        : el('p', { class: 'arena-note' }, 'No saved games yet - play one!'),
    );
  }
}

// Global leaderboard: each player's best score, optionally per difficulty.
export class LeaderboardView {
  constructor({ container, tabs, account, api = apiRequest }) {
    this.container = container;
    this.tabs = tabs;
    this.account = account;
    this.api = api;
    this.difficulty = 'all';
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      this.difficulty = tab.dataset.board;
      this.load();
    }));
  }

  async load() {
    this.tabs.forEach((t) => t.classList.toggle('active', t.dataset.board === this.difficulty));
    this.container.replaceChildren(loading('Loading leaderboard…'));
    try {
      const rows = await this.api(`/api/leaderboard?difficulty=${this.difficulty}&limit=10`);
      this.render(rows);
    } catch (err) {
      this.container.replaceChildren(el('p', { class: 'form-error' }, err.message));
    }
  }

  render(rows) {
    if (!rows.length) {
      this.container.replaceChildren(el('p', { class: 'arena-note' }, 'No scores yet. Be the first defender on the board!'));
      return;
    }
    const me = this.account.user && this.account.user.username;
    this.container.replaceChildren(el('table', { class: 'data-table' },
      el('thead', {}, el('tr', {}, ['#', 'Pilot', 'Score', 'Difficulty', 'Wave', 'Boss', 'Date'].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map((r) => el('tr', { class: r.username === me ? 'me' : '' },
        el('td', {}, r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank),
        el('td', {}, r.username),
        el('td', {}, r.score.toLocaleString()),
        el('td', {}, DIFFICULTY_LABEL[r.difficulty]),
        el('td', {}, r.waveReached),
        el('td', {}, r.bossDefeated ? '✔' : ''),
        el('td', {}, formatDate(r.createdAt)))))));
  }
}
