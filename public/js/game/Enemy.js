import { WORLD_HEIGHT } from './constants.js';
import { Projectile } from './Projectile.js';

// Base class for every alien. Subclasses override move() and attack() to
// give each type its own behaviour; shared bookkeeping (health, timers,
// escaping off-screen, firing helpers) lives here.
//
// `world` is the GameEngine (or a test double) and must provide:
//   world.player            - the player's position
//   world.spawnProjectile() - adds an enemy bullet to the game
//   world.bus               - EventBus for announcing events
export class Enemy {
  constructor({
    type,
    x,
    y,
    width = 36,
    height = 32,
    health = 1,
    speed = 100,
    points = 100,
    contactDamage = 20,
    escapeDamage = 10, // Earth shield damage if this alien gets past the player
    fireInterval = Infinity,
    projectileSpeed = 260,
    projectileDamage = 10,
    color = '#ff7b54',
    modifiers = {},
    rng = Math.random,
  }) {
    // Difficulty modifiers scale the base stats (see DifficultySettings).
    const m = { speed: 1, health: 1, fireRate: 1, projectileSpeed: 1, ...modifiers };
    this.type = type;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.maxHealth = Math.max(1, Math.round(health * m.health));
    this.health = this.maxHealth;
    this.speed = speed * m.speed;
    this.points = points;
    this.contactDamage = contactDamage;
    this.escapeDamage = escapeDamage;
    this.fireInterval = fireInterval / m.fireRate;
    this.projectileSpeed = projectileSpeed * m.projectileSpeed;
    this.projectileDamage = projectileDamage;
    this.color = color;
    this.rng = rng;
    this.alive = true;
    this.age = 0;
    this.hitFlash = 0;
    // Stagger the first shot so a group does not fire in perfect unison.
    this.fireTimer = Number.isFinite(this.fireInterval) ? this.fireInterval * (0.5 + rng() * 0.5) : Infinity;
  }

  update(dt, world) {
    if (!this.alive) return;
    this.age += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.move(dt, world);
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = this.fireInterval;
      this.attack(world);
    }
    if (this.y - this.height / 2 > WORLD_HEIGHT) {
      // Reached Earth - the wave system treats this as a breach.
      this.alive = false;
      world.bus.emit('enemy:escaped', { enemy: this });
    }
  }

  // Default: drift straight down.
  move(dt) {
    this.y += this.speed * dt;
  }

  // Default: no attack. Shooters override this.
  // eslint-disable-next-line no-unused-vars
  attack(world) {}

  // Returns true if this hit destroyed the enemy.
  takeHit(damage) {
    if (!this.alive) return false;
    this.health -= damage;
    this.hitFlash = 0.08;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      return true;
    }
    return false;
  }

  // Helpers for subclasses -------------------------------------------------

  fireStraight(world, vx = 0) {
    world.spawnProjectile(new Projectile({
      x: this.x,
      y: this.y + this.height / 2,
      vx,
      vy: this.projectileSpeed,
      radius: 5,
      damage: this.projectileDamage,
      owner: 'enemy',
    }));
  }

  fireAt(world, target) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const length = Math.hypot(dx, dy) || 1;
    world.spawnProjectile(new Projectile({
      x: this.x,
      y: this.y + this.height / 2,
      vx: (dx / length) * this.projectileSpeed,
      vy: (dy / length) * this.projectileSpeed,
      radius: 5,
      damage: this.projectileDamage,
      owner: 'enemy',
      color: '#ffd166',
    }));
  }

  // Rendering ----------------------------------------------------------------

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    this.drawShape(ctx);
    ctx.restore();
    if (this.maxHealth > 2 && this.health < this.maxHealth) this.drawHealthBar(ctx);
  }

  drawShape(ctx) {
    ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
  }

  drawHealthBar(ctx) {
    const w = this.width;
    const x = this.x - w / 2;
    const y = this.y - this.height / 2 - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(x, y, w * (this.health / this.maxHealth), 4);
  }
}
