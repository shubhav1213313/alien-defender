import { WORLD_WIDTH, WORLD_HEIGHT } from './game/constants.js';
import { InputHandler } from './game/InputHandler.js';
import { GameEngine } from './game/GameEngine.js';

const canvas = document.getElementById('game-canvas');
canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

const input = new InputHandler(window);
const engine = new GameEngine({ canvas, input });
const { bus } = engine;

// ---- Overlay screens follow the game state (event-driven UI) -------------
const overlays = document.querySelectorAll('.overlay');
function showOverlayFor(state) {
  overlays.forEach((el) => { el.hidden = el.dataset.state !== state; });
}
bus.on('state:change', ({ to }) => showOverlayFor(to));

bus.on('game:over', ({ survivedSeconds }) => {
  document.getElementById('gameover-summary').textContent =
    `You held the line for ${survivedSeconds.toFixed(1)} seconds.`;
});

// ---- Button events ---------------------------------------------------------
const click = (id, handler) => document.getElementById(id).addEventListener('click', handler);
click('btn-start', () => engine.startGame());
click('btn-restart', () => engine.startGame());
click('btn-resume', () => engine.togglePause());
click('btn-quit', () => engine.quitToMenu());
click('btn-menu', () => engine.quitToMenu());

// Enter starts the game from the menu or after game over.
input.on('confirm', () => {
  if (engine.state.is('menu') || engine.state.is('gameOver')) engine.startGame();
});

// Auto-pause when the tab is hidden so the player is not hit while away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.state.is('playing')) engine.togglePause();
});

engine.start();

// Show whether the browser can reach the Express API (frontend -> backend HTTP).
const statusEl = document.getElementById('server-status');
fetch('/api/health')
  .then((res) => res.json())
  .then((data) => { statusEl.textContent = data.success ? 'Server online' : 'Server error'; })
  .catch(() => { statusEl.textContent = 'Server offline'; });
