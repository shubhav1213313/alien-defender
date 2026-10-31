import { Scout, ZigzagRaider, ArmoredAlien, SniperAlien, KamikazeAlien } from './EnemyTypes.js';

// Factory pattern: the wave system asks for an enemy by name ("sniper") and
// never needs to know which class implements it. New alien types can be
// added by registering them here without touching the spawning code.
export class EnemyFactory {
  constructor({ modifiers = {}, rng = Math.random } = {}) {
    this.modifiers = modifiers; // difficulty scaling applied to every enemy
    this.rng = rng;
    this.registry = new Map([
      ['scout', Scout],
      ['zigzag', ZigzagRaider],
      ['armored', ArmoredAlien],
      ['sniper', SniperAlien],
      ['kamikaze', KamikazeAlien],
    ]);
  }

  register(type, EnemyClass) {
    this.registry.set(type, EnemyClass);
  }

  get types() {
    return [...this.registry.keys()];
  }

  create(type, x, y) {
    const EnemyClass = this.registry.get(type);
    if (!EnemyClass) throw new Error(`Unknown enemy type: ${type}`);
    return new EnemyClass({ x, y, modifiers: this.modifiers, rng: this.rng });
  }
}
