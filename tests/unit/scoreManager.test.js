import { ScoreManager, comboMultiplier, COMBO_WINDOW, MAX_MULTIPLIER } from '../../public/js/game/ScoreManager.js';
import { EventBus } from '../../public/js/game/EventBus.js';

describe('comboMultiplier', () => {
  test.each([
    [0, 1], [4, 1], [5, 1.5], [9, 1.5], [10, 2], [15, 2.5], [30, MAX_MULTIPLIER], [100, MAX_MULTIPLIER],
  ])('combo %i -> x%f', (combo, expected) => {
    expect(comboMultiplier(combo)).toBe(expected);
  });
});

describe('ScoreManager', () => {
  let bus;
  let score;

  beforeEach(() => {
    bus = new EventBus();
    score = new ScoreManager(bus);
  });

  test('awards points when an enemy:destroyed event is published', () => {
    bus.emit('enemy:destroyed', { points: 100 });
    expect(score.score).toBe(100);
    expect(score.combo).toBe(1);
  });

  test('rapid kills build a combo that multiplies points', () => {
    for (let i = 0; i < 5; i += 1) bus.emit('enemy:destroyed', { points: 100 });
    // Kills 1-4 at x1, kill 5 at x1.5
    expect(score.score).toBe(400 + 150);
    expect(score.multiplier).toBe(1.5);
  });

  test('combo expires after the combo window', () => {
    bus.emit('enemy:destroyed', { points: 100 });
    score.update(COMBO_WINDOW - 0.1);
    expect(score.combo).toBe(1);
    score.update(0.2);
    expect(score.combo).toBe(0);
  });

  test('losing hull health breaks the combo; shield-only hits do not', () => {
    for (let i = 0; i < 6; i += 1) bus.emit('enemy:destroyed', { points: 10 });
    bus.emit('player:damaged', { healthLost: 0, absorbed: 10 });
    expect(score.combo).toBe(6);
    bus.emit('player:damaged', { healthLost: 5, absorbed: 0 });
    expect(score.combo).toBe(0);
    expect(score.maxCombo).toBe(6);
  });

  test('difficulty multiplier scales kills and bonuses', () => {
    score.reset(1.5);
    bus.emit('enemy:destroyed', { points: 100 });
    expect(score.score).toBe(150);
    score.addBonus(1000, 'wave');
    expect(score.score).toBe(1650);
  });

  test('emits score:change for the HUD', () => {
    const handler = jest.fn();
    bus.on('score:change', handler);
    score.addBonus(500, 'wave');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ score: 500, points: 500, reason: 'wave' }));
  });

  test('reset clears score and combo', () => {
    bus.emit('enemy:destroyed', { points: 100 });
    score.reset();
    expect([score.score, score.combo, score.maxCombo]).toEqual([0, 0, 0]);
  });
});
