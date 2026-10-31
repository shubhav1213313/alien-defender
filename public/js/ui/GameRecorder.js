import { apiRequest } from '../api/apiClient.js';
import { el } from './dom.js';

// Saves games for logged-in players, driven entirely by game events:
//   game:start          -> POST /api/games            (server records start time)
//   game:over / victory -> POST /api/games/:id/result (score + achievements)
//   quit to menu        -> result saved as "abandoned"
// Guests can play normally; nothing is sent for them.
export class GameRecorder {
  constructor({ engine, account, api = apiRequest, root = document }) {
    this.engine = engine;
    this.account = account;
    this.api = api;
    this.statusBoxes = [...root.querySelectorAll('[data-save-status]')];
    this.gameSessionId = null;
    this.starting = null;

    const { bus } = engine;
    bus.on('game:start', ({ difficulty }) => this.start(difficulty));
    bus.on('game:over', (summary) => this.finish(summary));
    bus.on('game:victory', (summary) => this.finish(summary));
    bus.on('state:change', ({ from, to }) => {
      if (to === 'menu' && from === 'paused' && this.gameSessionId) this.finish(engine.summary('abandoned'));
    });
  }

  async start(difficulty) {
    this.gameSessionId = null;
    this.showStatus(null);
    if (!this.account.user) return;
    this.starting = this.api('/api/games', { method: 'POST', body: { difficulty } })
      .then((data) => { this.gameSessionId = data.gameSessionId; })
      .catch((err) => {
        if (err.status === 401) this.account.sessionExpired(err.message);
        this.startError = err.message;
      });
    await this.starting;
  }

  async finish(summary) {
    if (this.starting) await this.starting;
    const id = this.gameSessionId;
    this.gameSessionId = null;
    if (!id) {
      this.showStatus(this.account.user
        ? el('p', { class: 'warn' }, `Score not saved${this.startError ? `: ${this.startError}` : ''}.`)
        : el('p', { class: 'arena-note' }, 'Playing as guest - log in to save scores and unlock trophies.'));
      return;
    }
    this.showStatus(el('p', { class: 'arena-note' }, 'Saving score…'));
    try {
      const saved = await this.api(`/api/games/${id}/result`, {
        method: 'POST',
        body: {
          outcome: summary.reason,
          score: summary.score,
          waveReached: summary.wave,
          wavesCleared: summary.wavesCleared,
          enemiesDestroyed: summary.enemiesDestroyed,
          maxCombo: summary.maxCombo,
          shotsFired: summary.shotsFired,
          shotsHit: summary.shotsHit,
          abilitiesUsed: summary.abilitiesUsed,
          bossDefeated: summary.bossDefeated,
        },
      });
      this.showStatus(
        el('p', { class: 'saved' }, saved.personalBest ? '✔ Score saved - new personal best!' : '✔ Score saved'),
        saved.newAchievements.length
          ? el('ul', { class: 'new-trophies' }, saved.newAchievements.map((a) => el('li', {}, `${a.icon} Trophy unlocked: ${a.name}`)))
          : null,
      );
    } catch (err) {
      if (err.status === 401) this.account.sessionExpired(err.message);
      this.showStatus(el('p', { class: 'warn' }, `Score not saved: ${err.message}`));
    }
  }

  showStatus(...nodes) {
    // The same message goes on both end screens; only one is visible.
    for (const box of this.statusBoxes) box.replaceChildren(...nodes.filter(Boolean).map((n) => n.cloneNode(true)));
  }
}
