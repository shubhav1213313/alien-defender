// Scoring and combos. Listens to game events rather than being called
// directly - a clear example of the observer pattern in the game.
//
// Combo rules:
//  - each kill within `comboWindow` seconds of the previous one adds 1
//  - every 5 combo kills adds +0.5x to the multiplier (max 4x)
//  - taking hull damage or letting the combo timer run out resets it
export const COMBO_WINDOW = 2.5;
export const MAX_MULTIPLIER = 4;

export function comboMultiplier(combo) {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / 5) * 0.5);
}

export class ScoreManager {
  constructor(bus) {
    this.bus = bus;
    this.reset();
    bus.on('enemy:destroyed', ({ points }) => this.registerKill(points));
    bus.on('player:damaged', ({ healthLost }) => { if (healthLost > 0) this.breakCombo(); });
  }

  reset(difficultyMultiplier = 1) {
    this.difficultyMultiplier = difficultyMultiplier;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
  }

  get multiplier() {
    return comboMultiplier(this.combo);
  }

  registerKill(basePoints) {
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = COMBO_WINDOW;
    const points = Math.round(basePoints * this.multiplier * this.difficultyMultiplier);
    this.add(points);
    return points;
  }

  // Flat bonus (wave clear, quiz, boss) - scaled by difficulty, not combo.
  addBonus(basePoints, reason) {
    const points = Math.round(basePoints * this.difficultyMultiplier);
    this.add(points, reason);
    return points;
  }

  add(points, reason) {
    this.score += points;
    this.bus.emit('score:change', { score: this.score, points, reason, combo: this.combo, multiplier: this.multiplier });
  }

  breakCombo() {
    if (this.combo > 0) this.bus.emit('combo:broken', { combo: this.combo });
    this.combo = 0;
    this.comboTimer = 0;
  }

  update(dt) {
    if (this.comboTimer <= 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.breakCombo();
  }
}
