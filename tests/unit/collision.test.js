import {
  circlesOverlap,
  rectsOverlap,
  circleRectOverlap,
  CollisionManager,
} from '../../public/js/game/CollisionManager.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { Projectile } from '../../public/js/game/Projectile.js';

describe('collision geometry', () => {
  test('circles overlap when centres are closer than the radii sum', () => {
    expect(circlesOverlap({ x: 0, y: 0, radius: 5 }, { x: 8, y: 0, radius: 5 })).toBe(true);
    expect(circlesOverlap({ x: 0, y: 0, radius: 5 }, { x: 11, y: 0, radius: 5 })).toBe(false);
  });

  test('rectangles overlap only when both axes overlap', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 9, y: 9, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap(a, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 11, width: 10, height: 10 })).toBe(false);
  });

  test('circle vs rectangle uses the closest point (corners are handled)', () => {
    const rect = { x: 0, y: 0, width: 20, height: 20 }; // spans -10..10
    expect(circleRectOverlap({ x: 13, y: 0, radius: 4 }, rect)).toBe(true);
    expect(circleRectOverlap({ x: 15, y: 0, radius: 4 }, rect)).toBe(false);
    // Near a corner: dx = dy = 3 -> distance ~4.24 > 4
    expect(circleRectOverlap({ x: 13, y: 13, radius: 4 }, rect)).toBe(false);
    expect(circleRectOverlap({ x: 12, y: 12, radius: 4 }, rect)).toBe(true);
  });
});

describe('CollisionManager events', () => {
  let bus;
  let manager;

  beforeEach(() => {
    bus = new EventBus();
    manager = new CollisionManager(bus);
  });

  const enemyAt = (x, y) => ({ x, y, width: 30, height: 30, alive: true });

  test('player bullet hitting an enemy emits enemyHit and deactivates the bullet', () => {
    const hits = [];
    bus.on('collision:enemyHit', (e) => hits.push(e));
    const bullet = new Projectile({ x: 100, y: 100, owner: 'player' });
    const enemy = enemyAt(100, 105);
    manager.checkPlayerProjectiles([bullet], [enemy]);
    expect(hits).toHaveLength(1);
    expect(hits[0].enemy).toBe(enemy);
    expect(bullet.active).toBe(false);
  });

  test('one bullet only hits one enemy even if enemies overlap', () => {
    const hits = [];
    bus.on('collision:enemyHit', (e) => hits.push(e));
    const bullet = new Projectile({ x: 100, y: 100, owner: 'player' });
    manager.checkPlayerProjectiles([bullet], [enemyAt(100, 100), enemyAt(102, 100)]);
    expect(hits).toHaveLength(1);
  });

  test('enemy bullets do not hit enemies; dead enemies are ignored', () => {
    const handler = jest.fn();
    bus.on('collision:enemyHit', handler);
    const enemyBullet = new Projectile({ x: 100, y: 100, owner: 'enemy' });
    const playerBullet = new Projectile({ x: 300, y: 300, owner: 'player' });
    manager.checkPlayerProjectiles([enemyBullet, playerBullet], [enemyAt(100, 100), { ...enemyAt(300, 300), alive: false }]);
    expect(handler).not.toHaveBeenCalled();
  });

  test('enemy bullet hitting the player emits playerHit with its damage', () => {
    const handler = jest.fn();
    bus.on('collision:playerHit', handler);
    const player = { x: 200, y: 500, width: 44, height: 48 };
    const bullet = new Projectile({ x: 200, y: 495, owner: 'enemy', damage: 15 });
    manager.checkEnemyProjectiles([bullet], player);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ damage: 15 }));
    expect(bullet.active).toBe(false);
  });

  test('enemy ramming the player emits playerRammed', () => {
    const handler = jest.fn();
    bus.on('collision:playerRammed', handler);
    const player = { x: 200, y: 500, width: 44, height: 48 };
    manager.checkEnemyContact([{ ...enemyAt(210, 505), contactDamage: 30 }], player);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ damage: 30 }));
  });
});
