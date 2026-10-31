import { Player } from '../../public/js/game/Player.js';

const idle = { isDown: () => false };

describe('Player shooting', () => {
  test('fires a player-owned projectile upwards', () => {
    const p = new Player(300, 500);
    const shots = p.fire();
    expect(shots).toHaveLength(1);
    expect(shots[0].owner).toBe('player');
    expect(shots[0].vy).toBeLessThan(0);
    expect(shots[0].x).toBe(300);
  });

  test('cannot fire again until the cooldown has elapsed', () => {
    const p = new Player();
    expect(p.fire()).toHaveLength(1);
    expect(p.fire()).toHaveLength(0);
    p.update(p.fireCooldown / 2, idle);
    expect(p.fire()).toHaveLength(0);
    p.update(p.fireCooldown / 2 + 0.001, idle);
    expect(p.fire()).toHaveLength(1);
  });
});

describe('Player damage, shield and health', () => {
  test('shield absorbs damage before health', () => {
    const p = new Player();
    p.shield = 20;
    const result = p.takeDamage(30);
    expect(result).toEqual({ absorbed: 20, healthLost: 10, ignored: false });
    expect(p.shield).toBe(0);
    expect(p.health).toBe(90);
  });

  test('is invulnerable briefly after a hit, then can be hurt again', () => {
    const p = new Player();
    p.shield = 0;
    p.takeDamage(10);
    expect(p.isInvulnerable).toBe(true);
    expect(p.takeDamage(10).ignored).toBe(true);
    expect(p.health).toBe(90);
    p.update(p.invulnerabilityDuration + 0.01, idle);
    expect(p.isInvulnerable).toBe(false);
    p.takeDamage(10);
    expect(p.health).toBe(80);
  });

  test('health never drops below zero and a dead player cannot fire', () => {
    const p = new Player();
    p.shield = 0;
    p.takeDamage(999);
    expect(p.health).toBe(0);
    expect(p.isDead).toBe(true);
    expect(p.fire()).toHaveLength(0);
  });

  test('heal and addShield are capped at their maximums', () => {
    const p = new Player();
    p.health = 95;
    p.heal(50);
    expect(p.health).toBe(p.maxHealth);
    p.addShield(500);
    expect(p.shield).toBe(p.maxShield);
  });
});
