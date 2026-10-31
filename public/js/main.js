import { WORLD_WIDTH, WORLD_HEIGHT } from './game/constants.js';
import { InputHandler } from './game/InputHandler.js';
import { GameEngine } from './game/GameEngine.js';

const canvas = document.getElementById('game-canvas');
canvas.width = WORLD_WIDTH;
canvas.height = WORLD_HEIGHT;

const input = new InputHandler(window);
const engine = new GameEngine(canvas, input);
engine.start();

// Show whether the browser can reach the Express API (frontend -> backend HTTP).
const statusEl = document.getElementById('server-status');
fetch('/api/health')
  .then((res) => res.json())
  .then((data) => { statusEl.textContent = data.success ? 'Server online' : 'Server error'; })
  .catch(() => { statusEl.textContent = 'Server offline'; });
