import { Enemy } from './Enemy.js';
import { WORLD_WIDTH, clamp } from './constants.js';

// The five alien types. Each overrides move() and/or attack() so they play
// differently, not just with different numbers.

// 1. Scout - fast and fragile, weaves gently while diving.
export class Scout extends Enemy {
  constructor(opts) {
    super({ ...opts, type: 'scout', width: 30, height: 26, health: 1, speed: 170, points: 100, contactDamage: 15, color: '#7bdff2' });
    this.baseX = this.x;
    this.phase = this.rng() * Math.PI * 2;
  }

  move(dt) {
    this.y += this.speed * dt;
    // Subtract sin(phase) so the weave starts exactly at the spawn position
    // (otherwise the scout would jump sideways on its first frame).
    const weave = Math.sin(this.age * 3 + this.phase) - Math.sin(this.phase);
    this.x = clamp(this.baseX + weave * 30, 15, WORLD_WIDTH - 15);
  }

  drawShape(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.lineTo(15, -10);
    ctx.lineTo(0, -4);
    ctx.lineTo(-15, -10);
    ctx.closePath();
    ctx.fill();
  }
}

// 2. Zigzag Raider - changes horizontal direction at random intervals and
//    bounces off the screen edges, making it hard to line up a shot.
export class ZigzagRaider extends Enemy {
  constructor(opts) {
    super({ ...opts, type: 'zigzag', width: 34, height: 30, health: 2, speed: 90, points: 150, contactDamage: 20, color: '#c77dff' });
    this.horizontalSpeed = 220 * (this.speed / 90);
    this.direction = this.rng() < 0.5 ? -1 : 1;
    this.turnTimer = this.nextTurnDelay();
  }

  nextTurnDelay() {
    return 0.35 + this.rng() * 0.6;
  }

  move(dt) {
    this.y += this.speed * dt;
    this.x += this.direction * this.horizontalSpeed * dt;
    this.turnTimer -= dt;
    if (this.turnTimer <= 0) {
      this.direction *= -1;
      this.turnTimer = this.nextTurnDelay();
    }
    const half = this.width / 2;
    if (this.x < half || this.x > WORLD_WIDTH - half) {
      this.x = clamp(this.x, half, WORLD_WIDTH - half);
      this.direction *= -1;
    }
  }

  drawShape(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(17, 0);
    ctx.lineTo(0, 15);
    ctx.lineTo(-17, 0);
    ctx.closePath();
    ctx.fill();
  }
}

// 3. Armored Alien - slow, heavily armoured, fires a three-way spread.
export class ArmoredAlien extends Enemy {
  constructor(opts) {
    super({
      ...opts, type: 'armored', width: 52, height: 42, health: 7, speed: 45, points: 300,
      contactDamage: 35, fireInterval: 2.6, projectileSpeed: 220, projectileDamage: 12, color: '#ff9f1c',
    });
  }

  attack(world) {
    this.fireStraight(world, -90);
    this.fireStraight(world, 0);
    this.fireStraight(world, 90);
  }

  drawShape(ctx) {
    ctx.fillRect(-26, -14, 52, 28);
    ctx.fillRect(-14, -21, 28, 42);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-8, -6, 16, 12);
  }
}

// 4. Sniper Alien - flies to a hover line, strafes, and fires aimed shots at
//    the player after a visible charge-up (a fair telegraph).
export class SniperAlien extends Enemy {
  constructor(opts) {
    super({
      ...opts, type: 'sniper', width: 34, height: 34, health: 3, speed: 120, points: 250,
      contactDamage: 20, fireInterval: 2.2, projectileSpeed: 340, projectileDamage: 15, color: '#ffd166',
    });
    this.hoverY = 90 + this.rng() * 110;
    this.strafeDirection = this.rng() < 0.5 ? -1 : 1;
    this.chargeTime = 0.5;
    this.target = null;
  }

  get isCharging() {
    return this.fireTimer <= this.chargeTime;
  }

  move(dt, world) {
    if (this.y < this.hoverY) {
      this.y = Math.min(this.hoverY, this.y + this.speed * dt);
    } else if (!this.isCharging) {
      this.x += this.strafeDirection * this.speed * 0.6 * dt;
      const half = this.width / 2;
      if (this.x < half || this.x > WORLD_WIDTH - half) {
        this.x = clamp(this.x, half, WORLD_WIDTH - half);
        this.strafeDirection *= -1;
      }
    }
    // Lock on to where the player is while charging.
    if (this.isCharging && world.player) this.target = { x: world.player.x, y: world.player.y };
  }

  attack(world) {
    if (world.player) this.fireAt(world, world.player);
    this.target = null;
  }

  draw(ctx) {
    if (this.target) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.45)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.target.x, this.target.y);
      ctx.stroke();
      ctx.restore();
    }
    super.draw(ctx);
  }

  drawShape(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05070f';
    ctx.beginPath();
    ctx.arc(0, 3, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 5. Kamikaze Alien - enters, locks on, then accelerates straight at the
//    player. Explodes on contact for heavy damage.
export class KamikazeAlien extends Enemy {
  constructor(opts) {
    super({ ...opts, type: 'kamikaze', width: 28, height: 28, health: 2, speed: 80, points: 200, contactDamage: 35, color: '#ff4d6d' });
    this.lockOnDelay = 0.9;
    this.maxSpeed = this.speed * 4.5;
    this.acceleration = this.speed * 6;
    this.currentSpeed = this.speed;
    this.vx = 0;
    this.vy = this.speed;
  }

  get isDiving() {
    return this.age >= this.lockOnDelay;
  }

  move(dt, world) {
    if (this.isDiving && world.player) {
      this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.acceleration * dt);
      const dx = world.player.x - this.x;
      const dy = world.player.y - this.y;
      const length = Math.hypot(dx, dy) || 1;
      // Steer towards the player but with limited turning, so it can be dodged.
      const steer = Math.min(1, 3 * dt);
      this.vx += ((dx / length) * this.currentSpeed - this.vx) * steer;
      this.vy += ((dy / length) * this.currentSpeed - this.vy) * steer;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  drawShape(ctx) {
    const angle = Math.atan2(this.vy, this.vx) - Math.PI / 2;
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(12, -12);
    ctx.lineTo(-12, -12);
    ctx.closePath();
    ctx.fill();
  }
}
