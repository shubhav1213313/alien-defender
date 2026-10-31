import { EnemyFactory } from '../../public/js/game/EnemyFactory.js';
import { Enemy } from '../../public/js/game/Enemy.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../public/js/game/constants.js';

// Deterministic "random" numbers so behaviour is repeatable in tests.
const fixedRng = (value = 0.5) => () => value;

// Minimal world double: records bullets and events.
function fakeWorld(player = { x: 480, y: 560 }) {
  const bus = new EventBus();
  const world = { player, bus, bullets: [], events: [] };
  world.spawnProjectile = (p) => world.bullets.push(p);
  bus.on('enemy:escaped', (e) => world.events.push(e));
  return world;
}

function run(enemy, world, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) enemy.update(step, world);
}

describe('EnemyFactory', () => {
  const factory = new EnemyFactory({ rng: fixedRng() });

  test('creates all five distinct enemy types', () => {
    expect(factory.types).toEqual(['scout', 'zigzag', 'armored', 'sniper', 'kamikaze']);
    for (const type of factory.types) {
      const enemy = factory.create(type, 100, 50);
      expect(enemy).toBeInstanceOf(Enemy);
      expect(enemy.type).toBe(type);
      expect([enemy.x, enemy.y]).toEqual([100, 50]);
    }
  });

  test('types differ meaningfully in health, speed and points', () => {
    const [scout, armored] = ['scout', 'armored'].map((t) => factory.create(t, 0, 0));
    expect(scout.speed).toBeGreaterThan(armored.speed);
    expect(armored.maxHealth).toBeGreaterThan(scout.maxHealth);
    expect(armored.points).toBeGreaterThan(scout.points);
  });

  test('unknown types throw a clear error', () => {
    expect(() => factory.create('dragon', 0, 0)).toThrow('Unknown enemy type: dragon');
  });

  test('new types can be registered without changing spawning code', () => {
    class Drone extends Enemy {
      constructor(opts) { super({ ...opts, type: 'drone' }); }
    }
    const f = new EnemyFactory();
    f.register('drone', Drone);
    expect(f.create('drone', 0, 0)).toBeInstanceOf(Drone);
  });

  test('difficulty modifiers scale speed, health and fire rate', () => {
    const normal = new EnemyFactory({ rng: fixedRng() }).create('armored', 0, 0);
    const hard = new EnemyFactory({ rng: fixedRng(), modifiers: { speed: 1.5, health: 2, fireRate: 2 } }).create('armored', 0, 0);
    expect(hard.speed).toBeCloseTo(normal.speed * 1.5);
    expect(hard.maxHealth).toBe(normal.maxHealth * 2);
    expect(hard.fireInterval).toBeCloseTo(normal.fireInterval / 2);
  });
});

describe('Enemy base behaviour', () => {
  const factory = new EnemyFactory({ rng: fixedRng() });

  test('takeHit reduces health and reports destruction', () => {
    const zig = factory.create('zigzag', 100, 100); // 2 health
    expect(zig.takeHit(1)).toBe(false);
    expect(zig.alive).toBe(true);
    expect(zig.takeHit(1)).toBe(true);
    expect(zig.alive).toBe(false);
    expect(zig.takeHit(1)).toBe(false); // already dead
  });

  test('an enemy that reaches the bottom escapes and emits enemy:escaped', () => {
    const world = fakeWorld();
    const scout = factory.create('scout', 200, WORLD_HEIGHT - 5);
    run(scout, world, 1);
    expect(scout.alive).toBe(false);
    expect(world.events).toHaveLength(1);
    expect(world.events[0].enemy).toBe(scout);
  });
});

describe('Enemy type behaviours', () => {
  test('Scout dives quickly and weaves within the screen', () => {
    const world = fakeWorld();
    const scout = new EnemyFactory({ rng: fixedRng() }).create('scout', 200, 0);
    run(scout, world, 1);
    expect(scout.y).toBeGreaterThan(150);
    expect(Math.abs(scout.x - 200)).toBeLessThanOrEqual(60);
    expect(world.bullets).toHaveLength(0); // scouts do not shoot
  });

  test.each([0, 0.25, 0.5, 0.75, 0.99])('Scout does not jump sideways on its first frame (rng=%s)', (r) => {
    const scout = new EnemyFactory({ rng: fixedRng(r) }).create('scout', 300, 0);
    scout.update(1 / 60, fakeWorld());
    expect(Math.abs(scout.x - 300)).toBeLessThan(2);
  });

  test('Zigzag Raider changes horizontal direction and stays on screen', () => {
    const world = fakeWorld();
    const zig = new EnemyFactory({ rng: fixedRng(0.3) }).create('zigzag', WORLD_WIDTH / 2, 0);
    const startDirection = zig.direction;
    let flipped = false;
    for (let i = 0; i < 120; i += 1) {
      zig.update(1 / 60, world);
      if (zig.direction !== startDirection) flipped = true;
      expect(zig.x).toBeGreaterThanOrEqual(zig.width / 2);
      expect(zig.x).toBeLessThanOrEqual(WORLD_WIDTH - zig.width / 2);
    }
    expect(flipped).toBe(true);
  });

  test('Armored Alien fires a three-shot spread', () => {
    const world = fakeWorld();
    const tank = new EnemyFactory({ rng: fixedRng() }).create('armored', 300, 50);
    run(tank, world, tank.fireInterval + 0.1);
    expect(world.bullets.length).toBeGreaterThanOrEqual(3);
    const vxs = world.bullets.slice(0, 3).map((b) => Math.sign(b.vx));
    expect(vxs).toEqual([-1, 0, 1]);
    expect(world.bullets.every((b) => b.owner === 'enemy')).toBe(true);
  });

  test('Sniper stops at its hover line and fires an aimed shot at the player', () => {
    const player = { x: 800, y: 560 };
    const world = fakeWorld(player);
    const sniper = new EnemyFactory({ rng: fixedRng(0) }).create('sniper', 100, -20);
    run(sniper, world, 3);
    expect(sniper.y).toBeCloseTo(sniper.hoverY);
    expect(world.bullets.length).toBeGreaterThan(0);
    const shot = world.bullets[0];
    // The bullet's velocity points from the sniper towards the player.
    expect(shot.vx).toBeGreaterThan(0);
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.hypot(shot.vx, shot.vy)).toBeCloseTo(sniper.projectileSpeed);
  });

  test('Kamikaze locks on and accelerates towards the player', () => {
    const player = { x: 700, y: 560 };
    const world = fakeWorld(player);
    const kamikaze = new EnemyFactory({ rng: fixedRng() }).create('kamikaze', 200, 50);
    run(kamikaze, world, kamikaze.lockOnDelay * 0.9);
    expect(kamikaze.isDiving).toBe(false);
    const distanceBefore = Math.hypot(player.x - kamikaze.x, player.y - kamikaze.y);
    run(kamikaze, world, 0.8);
    expect(kamikaze.isDiving).toBe(true);
    expect(kamikaze.currentSpeed).toBeGreaterThan(kamikaze.speed);
    expect(kamikaze.vx).toBeGreaterThan(0); // steering right towards the player
    expect(Math.hypot(player.x - kamikaze.x, player.y - kamikaze.y)).toBeLessThan(distanceBefore);
  });
});
