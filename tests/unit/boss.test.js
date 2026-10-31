import { Boss, BOSS_PHASE_THRESHOLDS } from '../../public/js/game/Boss.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { WORLD_WIDTH } from '../../public/js/game/constants.js';

function fakeWorld() {
  const bus = new EventBus();
  const world = { bus, player: { x: 480, y: 560 }, bullets: [], summoned: [], phases: [] };
  world.spawnProjectile = (p) => world.bullets.push(p);
  world.spawnEnemy = (type, x, y) => world.summoned.push({ type, x, y });
  bus.on('boss:phase', ({ phase }) => world.phases.push(phase));
  return world;
}

const run = (boss, world, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) boss.update(1 / 60, world);
};

// A boss that has finished its entrance.
function readyBoss(opts = {}) {
  const boss = new Boss({ x: WORLD_WIDTH / 2, y: -80, rng: () => 0.5, ...opts });
  const world = fakeWorld();
  run(boss, world, 5);
  world.bullets.length = 0;
  return { boss, world };
}

// Deal damage without being blocked by phase-change shields.
function damageTo(boss, ratio) {
  boss.phaseShield = 0;
  boss.takeHit(boss.health - Math.ceil(boss.maxHealth * ratio));
}

describe('Boss phases', () => {
  test.each([[1, 1], [0.7, 1], [0.66, 2], [0.4, 2], [0.33, 3], [0.01, 3]])('health %f -> phase %i', (ratio, phase) => {
    expect(Boss.phaseFor(ratio)).toBe(phase);
  });

  test('thresholds are at two-thirds and one-third', () => {
    expect(BOSS_PHASE_THRESHOLDS).toEqual([2 / 3, 1 / 3]);
  });

  test('cannot be damaged during its entrance', () => {
    const boss = new Boss({ x: 480, y: -80 });
    expect(boss.takeHit(50)).toBe(false);
    expect(boss.health).toBe(boss.maxHealth);
  });

  test('flies in, stops at its entry line and becomes vulnerable', () => {
    const { boss } = readyBoss();
    expect(boss.entering).toBe(false);
    expect(boss.y).toBe(boss.entryY);
    boss.takeHit(5);
    expect(boss.health).toBe(boss.maxHealth - 5);
  });

  test('phase change emits boss:phase and grants a brief invulnerable window', () => {
    const { boss, world } = readyBoss();
    damageTo(boss, 0.6);
    expect(boss.phase).toBe(2);
    expect(boss.isInvulnerable).toBe(true);
    const hp = boss.health;
    boss.takeHit(10);
    expect(boss.health).toBe(hp); // shielded
    boss.update(1 / 60, world);
    expect(world.phases).toEqual([2]);
    run(boss, world, 1.5);
    expect(boss.isInvulnerable).toBe(false);
  });

  test('moves through all three phases and can be destroyed', () => {
    const { boss, world } = readyBoss();
    damageTo(boss, 0.6);
    boss.update(1 / 60, world);
    damageTo(boss, 0.2);
    boss.update(1 / 60, world);
    expect(world.phases).toEqual([2, 3]);
    boss.phaseShield = 0;
    expect(boss.takeHit(boss.health)).toBe(true);
    expect(boss.alive).toBe(false);
  });

  test('difficulty modifiers scale boss health', () => {
    const easy = new Boss({ x: 0, y: 0, modifiers: { health: 0.75 } });
    const hard = new Boss({ x: 0, y: 0, modifiers: { health: 1.5 } });
    expect(hard.maxHealth).toBeGreaterThan(easy.maxHealth);
  });
});

describe('Boss attack patterns', () => {
  test('phase 1 fires fans and aimed shots, but summons nothing', () => {
    const { boss, world } = readyBoss();
    run(boss, world, 4);
    expect(world.bullets.length).toBeGreaterThanOrEqual(8);
    expect(world.summoned).toHaveLength(0);
  });

  test('phase 2 summons escorts', () => {
    const { boss, world } = readyBoss();
    damageTo(boss, 0.5);
    run(boss, world, 12);
    expect(world.summoned.length).toBeGreaterThan(0);
    expect(world.summoned.every((s) => ['scout', 'zigzag'].includes(s.type))).toBe(true);
  });

  test('phase 3 fires more bullets per second than phase 1', () => {
    const p1 = readyBoss();
    run(p1.boss, p1.world, 5);
    const p3 = readyBoss();
    damageTo(p3.boss, 0.2);
    run(p3.boss, p3.world, 5);
    expect(p3.world.bullets.length).toBeGreaterThan(p1.world.bullets.length * 2);
  });

  test('phase 3 curtain always leaves a safe gap', () => {
    const { boss, world } = readyBoss();
    boss.fireCurtain(world);
    const xs = world.bullets.map((b) => b.x);
    expect(xs.length).toBeGreaterThan(20);
    const gap = boss.lastCurtainGap;
    expect(xs.every((x) => Math.abs(x - gap) >= 75)).toBe(true);
  });

  test('stays within the screen horizontally', () => {
    const { boss, world } = readyBoss();
    damageTo(boss, 0.2);
    for (let i = 0; i < 1200; i += 1) {
      boss.update(1 / 60, world);
      expect(boss.x).toBeGreaterThanOrEqual(boss.width / 2);
      expect(boss.x).toBeLessThanOrEqual(WORLD_WIDTH - boss.width / 2);
    }
  });

  test('holds aimed fire while the player cannot be targeted', () => {
    const { boss, world } = readyBoss();
    world.target = null;
    run(boss, world, 3.5);
    const aimed = world.bullets.filter((b) => b.color === '#ffd166');
    expect(aimed).toHaveLength(0);
  });
});
