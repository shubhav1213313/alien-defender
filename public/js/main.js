import { WORLD_WIDTH, WORLD_HEIGHT } from './game/constants.js';
import { InputHandler } from './game/InputHandler.js';
import { GameEngine } from './game/GameEngine.js';
import { getDifficulty } from './game/DifficultySettings.js';
import { KnowledgeArena } from './ui/KnowledgeArena.js';
import { SpecialOffer } from './ui/SpecialOffer.js';
import { Panels } from './ui/Panels.js';
import { AccountUI } from './ui/AccountUI.js';
import { ProfileView, LeaderboardView } from './ui/PlayerViews.js';
import { GameRecorder } from './ui/GameRecorder.js';
import { QuoteView, ApiStatusIndicator } from './ui/InfoWidgets.js';
import { AdminView } from './ui/AdminView.js';
import { AudioManager } from './audio/AudioManager.js';
import { SoundControls } from './ui/SoundControls.js';

const canvas = document.getElementById('game-canvas');
canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

const input = new InputHandler(window);
const engine = new GameEngine({ canvas, input });
const { bus } = engine;

// ---- Sound effects and music (listen to game events; start on first click/key) ----
const audio = new AudioManager({ bus });
new SoundControls({ audio, container: document.getElementById('sound-controls'), input });

// ---- Virtual identity: account, profile, leaderboard, saved games --------
const panels = new Panels();
const account = new AccountUI({ bus, panels });
const recorder = new GameRecorder({ engine, account });
const profile = new ProfileView({ container: document.querySelector('[data-profile-body]'), account });
const leaderboard = new LeaderboardView({
  container: document.querySelector('[data-leaderboard-body]'),
  tabs: [...document.querySelectorAll('[data-board]')],
  account,
});
panels.onOpen('profile', () => profile.load());
panels.onOpen('leaderboard', () => leaderboard.load());
const adminView = new AdminView({ container: document.querySelector('[data-admin-body]'), account });
panels.onOpen('admin', () => adminView.load());
account.restore();

// ---- Second external API (ZenQuotes) and API latency indicator ------------
const quotes = new QuoteView({ bus });
const apiStatus = new ApiStatusIndicator({ bus, element: document.getElementById('api-status') });
quotes.load('menu');
apiStatus.refresh();

// The Knowledge Challenge listens for 'arena:open' (after waves 1-4, after
// the boss, or when the special invitation is accepted) and drives the
// puzzle screens. Results are linked to the saved game for logged-in players.
new KnowledgeArena({
  engine,
  root: document.getElementById('screen-arena'),
  getGameSessionId: () => recorder.gameSessionId,
  getDifficulty: () => engine.difficulty.id,
});
new SpecialOffer({ engine, element: document.getElementById('special-offer') });

const selectedDifficulty = () => document.querySelector('input[name="difficulty"]:checked').value;
const startGame = () => {
  panels.close();
  engine.startGame(selectedDifficulty());
};

// ---- Overlay screens follow the game state (event-driven UI) -------------
const overlays = document.querySelectorAll('.overlay[data-state]');
function showOverlayFor(state) {
  overlays.forEach((el) => { el.hidden = el.dataset.state !== state; });
}
bus.on('state:change', ({ to }) => showOverlayFor(to));

function renderSummary(listId, summary) {
  const accuracy = summary.shotsFired ? Math.round((summary.shotsHit / summary.shotsFired) * 100) : 0;
  const rows = [
    ['Score', summary.score.toLocaleString()],
    ['Difficulty', getDifficulty(summary.difficulty).label],
    ['Wave reached', `${summary.wave} / 5`],
    ['Aliens destroyed', summary.enemiesDestroyed],
    ['Best combo', summary.maxCombo],
    ['Accuracy', `${accuracy}%`],
    ['Puzzles solved', `${summary.arenaCorrect} / ${summary.arenaQuestions}`],
    ['Abilities used', summary.abilitiesUsed],
  ];
  if (summary.energyBonus) rows.push(['Leftover energy bonus', `+${summary.energyBonus.toLocaleString()}`]);
  if (summary.achievements.includes('legendary_defender')) rows.push(['Achievement', 'Legendary Defender']);
  const list = document.getElementById(listId);
  list.replaceChildren(...rows.flatMap(([label, value]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    return [dt, dd];
  }));
}

bus.on('game:over', (summary) => {
  document.getElementById('gameover-title').textContent =
    summary.reason === 'earthFallen' ? "Earth's Shield Has Fallen" : 'Your Ship Was Destroyed';
  renderSummary('gameover-summary', summary);
});
bus.on('game:victory', (summary) => renderSummary('victory-summary', summary));

// ---- Button events ---------------------------------------------------------
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-resume').addEventListener('click', () => engine.togglePause());
document.getElementById('btn-quit').addEventListener('click', () => engine.quitToMenu());
document.querySelectorAll('[data-action="restart"]').forEach((b) => b.addEventListener('click', startGame));
document.querySelectorAll('[data-action="menu"]').forEach((b) => b.addEventListener('click', () => engine.quitToMenu()));

// Enter starts a game from the menu or an end screen (ignored mid-game and
// while a panel such as the login form is open).
input.on('confirm', () => {
  if (!panels.current) startGame();
});

// Auto-pause when the tab is hidden so the player is not hit while away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.isActive) engine.togglePause();
});

engine.start();

// Show whether the browser can reach the Express API (frontend -> backend HTTP).
const statusEl = document.getElementById('server-status');
fetch('/api/health')
  .then((res) => res.json())
  .then((data) => { statusEl.textContent = data.success ? 'Server online' : 'Server error'; })
  .catch(() => { statusEl.textContent = 'Server offline'; });
