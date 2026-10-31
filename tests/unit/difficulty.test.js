import { DIFFICULTIES, getDifficulty } from '../../public/js/game/DifficultySettings.js';
import { EnemyFactory } from '../../public/js/game/EnemyFactory.js';
import { GameEngine } from '../../public/js/game/GameEngine.js';

const input = { isDown: () => false, on: () => {}, releaseAll: () => {} };

describe('Difficulty strategies', () => {
  const { easy, normal, hard } = DIFFICULTIES;

  test('there are exactly three modes', () => {
    expect(Object.keys(DIFFICULTIES)).toEqual(['easy', 'normal', 'hard']);
  });

  test('unknown ids fall back to normal', () => {
    expect(getDifficulty('nightmare')).toBe(normal);
    expect(getDifficulty('hard')).toBe(hard);
  });

  test('every gameplay value gets strictly harder from easy to normal to hard', () => {
    for (const key of ['speed', 'health', 'fireRate', 'projectileSpeed']) {
      expect(easy.enemyModifiers[key]).toBeLessThan(normal.enemyModifiers[key]);
      expect(normal.enemyModifiers[key]).toBeLessThan(hard.enemyModifiers[key]);
    }
    expect(easy.playerDamageTaken).toBeLessThan(normal.playerDamageTaken);
    expect(normal.playerDamageTaken).toBeLessThan(hard.playerDamageTaken);
    // Larger interval = slower spawns = easier.
    expect(easy.spawnInterval).toBeGreaterThan(normal.spawnInterval);
    expect(normal.spawnInterval).toBeGreaterThan(hard.spawnInterval);
    expect(easy.earthShield).toBeGreaterThan(hard.earthShield);
  });

  test('harder modes reward more points', () => {
    expect(easy.scoreMultiplier).toBeLessThan(hard.scoreMultiplier);
  });

  test('settings objects are frozen so they cannot be changed at runtime', () => {
    expect(Object.isFrozen(hard)).toBe(true);
    expect(Object.isFrozen(hard.enemyModifiers)).toBe(true);
  });

  test('the same alien is genuinely faster and tougher on hard', () => {
    const e = new EnemyFactory({ modifiers: easy.enemyModifiers }).create('armored', 0, 0);
    const h = new EnemyFactory({ modifiers: hard.enemyModifiers }).create('armored', 0, 0);
    expect(h.speed).toBeGreaterThan(e.speed);
    expect(h.maxHealth).toBeGreaterThan(e.maxHealth);
    expect(h.fireInterval).toBeLessThan(e.fireInterval);
    expect(h.projectileSpeed).toBeGreaterThan(e.projectileSpeed);
  });

  test('the engine applies player damage scaling and Earth shield per mode', () => {
    const results = {};
    for (const id of ['easy', 'hard']) {
      const engine = new GameEngine({ input });
      engine.startGame(id);
      engine.player.shield = 0;
      engine.damagePlayer(20);
      results[id] = { health: engine.player.health, earth: engine.earth.maxShield };
    }
    expect(results.easy.health).toBe(100 - 20 * easy.playerDamageTaken);
    expect(results.hard.health).toBe(100 - 20 * hard.playerDamageTaken);
    expect(results.easy.earth).toBe(easy.earthShield);
    expect(results.hard.earth).toBe(hard.earthShield);
  });
});
