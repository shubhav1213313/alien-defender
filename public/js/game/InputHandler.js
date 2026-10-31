// Translates raw keyboard events into game actions (event-driven input).
// The game loop polls isDown(action) each frame for smooth movement, while
// one-shot actions such as 'pause' are delivered to subscribers via on().
const KEY_BINDINGS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'fire',
  KeyP: 'pause', Escape: 'pause',
  Enter: 'confirm',
  KeyE: 'ability',
  Digit1: 'ability1', Digit2: 'ability2', Digit3: 'ability3', Digit4: 'ability4',
};

export class InputHandler {
  constructor(target) {
    this.pressed = new Set();
    this.listeners = new Map();
    this.enabled = true;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  // Subscribe to a one-shot action (fires once per key press, not per frame).
  on(action, callback) {
    if (!this.listeners.has(action)) this.listeners.set(action, []);
    this.listeners.get(action).push(callback);
  }

  emit(action) {
    (this.listeners.get(action) || []).forEach((cb) => cb());
  }

  onKeyDown(event) {
    // Let the player type freely in form fields (quiz answers, login).
    if (isTypingTarget(event)) return;
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    // Stop arrows/space from scrolling the page while playing.
    if (event.preventDefault) event.preventDefault();
    if (!event.repeat && !this.pressed.has(action)) this.emit(action);
    this.pressed.add(action);
  }

  onKeyUp(event) {
    const action = KEY_BINDINGS[event.code];
    if (action) this.pressed.delete(action);
  }

  // Release all keys when the window loses focus so the ship does not drift.
  onBlur() {
    this.pressed.clear();
  }

  isDown(action) {
    return this.pressed.has(action);
  }

  // Lets on-screen touch buttons feed the same action system as the keyboard.
  setVirtual(action, down) {
    if (down) {
      if (!this.pressed.has(action)) this.emit(action);
      this.pressed.add(action);
    } else {
      this.pressed.delete(action);
    }
  }

  releaseAll() {
    this.pressed.clear();
  }

  destroy() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }
}

function isTypingTarget(event) {
  const tag = event.target && event.target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
