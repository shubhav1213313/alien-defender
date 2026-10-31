import { WORLD_WIDTH, WORLD_HEIGHT, clamp } from './constants.js';
import { Projectile } from './Projectile.js';

// The player's spaceship. update()/fire()/takeDamage() hold the pure logic;
// draw() only renders, so the logic can be unit tested without a canvas.
export class Player {
  constructor(x = WORLD_WIDTH / 2, y = WORLD_HEIGHT - 80) {
    this.width = 44;
    this.height = 48;
    this.x = x;
    this.y = y;
    this.speed = 340; // logical pixels per second

    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.maxShield = 50;
    this.shield = 25;

    // Brief invulnerability after a hit so one burst cannot chain-kill you.
    this.invulnerabilityDuration = 1.0;
    this.invulnerableTimer = 0;

    this.fireCooldown = 0.18; // seconds between shots
    this.cooldownTimer = 0;
    this.projectileSpeed = 640;
    this.projectileDamage = 1;
  }

  get isDead() {
    return this.health <= 0;
  }

  get isInvulnerable() {
    return this.invulnerableTimer > 0;
  }

  // dt is in seconds, so movement is identical at 30fps or 144fps.
  update(dt, input) {
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);

    let dx = 0;
    let dy = 0;
    if (input.isDown('left')) dx -= 1;
    if (input.isDown('right')) dx += 1;
    if (input.isDown('up')) dy -= 1;
    if (input.isDown('down')) dy += 1;

    // Normalise diagonals so moving diagonally is not ~41% faster.
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
    this.clampToBounds();
  }

  clampToBounds() {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    // The player is confined to the lower 60% of the screen.
    this.x = clamp(this.x, halfW, WORLD_WIDTH - halfW);
    this.y = clamp(this.y, WORLD_HEIGHT * 0.4, WORLD_HEIGHT - halfH);
  }

  canFire() {
    return this.cooldownTimer <= 0 && !this.isDead;
  }

  // Returns the new projectiles (empty while on cooldown).
  fire() {
    if (!this.canFire()) return [];
    this.cooldownTimer = this.fireCooldown;
    return [
      new Projectile({
        x: this.x,
        y: this.y - this.height / 2,
        vy: -this.projectileSpeed,
        damage: this.projectileDamage,
        owner: 'player',
      }),
    ];
  }

  // Shield absorbs damage first, then health. Returns what actually happened
  // so callers (HUD, achievements) can react.
  takeDamage(amount) {
    if (amount <= 0 || this.isInvulnerable || this.isDead) {
      return { absorbed: 0, healthLost: 0, ignored: true };
    }
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    const healthLost = Math.min(this.health, amount - absorbed);
    this.health -= healthLost;
    this.invulnerableTimer = this.invulnerabilityDuration;
    return { absorbed, healthLost, ignored: false };
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  addShield(amount) {
    this.shield = Math.min(this.maxShield, this.shield + amount);
  }

  draw(ctx) {
    // Blink while invulnerable.
    if (this.isInvulnerable && Math.floor(this.invulnerableTimer * 12) % 2 === 0) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    // Engine glow
    ctx.fillStyle = 'rgba(57, 243, 196, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 24, 8, 14 + Math.random() * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Hull
    ctx.fillStyle = '#d9e7ff';
    ctx.strokeStyle = '#39f3c4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(20, 18);
    ctx.lineTo(6, 12);
    ctx.lineTo(0, 20);
    ctx.lineTo(-6, 12);
    ctx.lineTo(-20, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Cockpit
    ctx.fillStyle = '#1b6cff';
    ctx.beginPath();
    ctx.ellipse(0, -4, 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Shield bubble
    if (this.shield > 0) {
      ctx.strokeStyle = `rgba(80, 170, 255, ${0.25 + 0.5 * (this.shield / this.maxShield)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 32, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
