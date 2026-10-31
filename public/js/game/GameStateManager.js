// State pattern (finite state machine) for the overall game flow.
// Each state lists which states it may move to, so illegal jumps such as
// MENU -> VICTORY are rejected instead of silently corrupting the game.
export const GameState = Object.freeze({
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  QUIZ: 'quiz',
  WAVE_TRANSITION: 'waveTransition',
  GAME_OVER: 'gameOver',
  VICTORY: 'victory',
});

const { MENU, PLAYING, PAUSED, QUIZ, WAVE_TRANSITION, GAME_OVER, VICTORY } = GameState;

const TRANSITIONS = {
  [MENU]: [PLAYING],
  [PLAYING]: [PAUSED, QUIZ, WAVE_TRANSITION, GAME_OVER, VICTORY, MENU],
  [PAUSED]: [PLAYING, MENU],
  [QUIZ]: [PLAYING, WAVE_TRANSITION, MENU],
  [WAVE_TRANSITION]: [PLAYING, QUIZ, PAUSED, GAME_OVER, MENU],
  [GAME_OVER]: [PLAYING, MENU],
  [VICTORY]: [PLAYING, MENU],
};

export class GameStateManager {
  constructor(bus) {
    this.bus = bus;
    this.state = MENU;
    this.previous = null;
  }

  is(state) {
    return this.state === state;
  }

  canTransition(to) {
    return (TRANSITIONS[this.state] || []).includes(to);
  }

  // Moves to a new state and announces it on the event bus.
  transition(to) {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid game state transition: ${this.state} -> ${to}`);
    }
    const from = this.state;
    this.previous = from;
    this.state = to;
    if (this.bus) this.bus.emit('state:change', { from, to });
    return true;
  }

  // Safe variant for UI handlers: returns false instead of throwing.
  tryTransition(to) {
    return this.canTransition(to) ? this.transition(to) : false;
  }

  // Should the world simulation (movement, enemies, bullets) advance?
  get isSimulating() {
    return this.state === PLAYING || this.state === WAVE_TRANSITION;
  }
}
