import { WORLD_WIDTH, WORLD_HEIGHT } from './game/constants.js';
import { InputHandler } from './game/InputHandler.js';
import { GameEngine } from './game/GameEngine.js';
import { getDifficulty } from './game/DifficultySettings.js';
import { KnowledgeArena } from './ui/KnowledgeArena.js';

const canvas = document.getElementById('game-canvas');
canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

const input = new InputHandler(window);
const engine = new GameEngine({ canvas, input });
const { bus } = engine;

// The arena listens for 'arena:open' and drives the puzzle screens.
new KnowledgeArena({ engine, root: document.getElementById('screen-arena') });

const selectedDifficulty = () => document.querySelector('input[name="difficulty"]:checked').value;
const startGame = () => engine.startGame(selectedDifficulty());

// ---- Overlay screens follow the game state (event-driven UI) -------------
const overlays = document.querySelectorAll('.overlay');
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

// Enter starts a game from the menu or an end screen (ignored mid-game).
input.on('confirm', startGame);

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
