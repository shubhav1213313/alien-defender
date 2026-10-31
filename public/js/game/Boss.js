import { Enemy } from './Enemy.js';
import { Projectile } from './Projectile.js';
import { WORLD_WIDTH, clamp } from './constants.js';

// The final Mothership. Its phase is decided by remaining health:
//   Phase 1 (100%-67%): steady side-to-side sweep, 5-way fans, aimed triples
//   Phase 2 (67%-34%):  faster, wide spreads, aimed bursts, summons escorts
//   Phase 3 (<34%):     erratic, rotating bullet spiral, bullet curtains with
//                       a single safe gap, kamikaze summons
// Changing phase grants a short invulnerable window and is announced with a
// 'boss:phase' event so the engine can show effects.
export const BOSS_PHASE_THRESHOLDS = [2 / 3, 1 / 3];

const PHASE_SETTINGS = {
  1: { speed: 90, fanInterval: 1.4, aimedInterval: 3.0 },
  2: { speed: 150, spreadInterval: 1.0, aimedInterval: 2.2, summonInterval: 7 },
  3: { speed: 190, spiralInterval: 0.14, curtainInterval: 4.2, summonInterval: 9 },
};

export class Boss extends Enemy {
  constructor(opts) {
    super({
      ...opts,
      type: 'boss',
      width: 220,
      height: 100,
      health: 300,
      speed: 90,
      points: 5000,
      contactDamage: 40,
      escapeDamage: 0,
      projectileSpeed: 230,
      projectileDamage: 12,
      color: '#b5179e',
    });
    this.isBoss = true;
    this.phase = 1;
    this.entryY = 130;
    this.entering = true;
    this.direction = 1;
    this.phaseShield = 0; // invulnerable seconds after a phase change
    this.pendingPhase = null;
    this.timers = { fan: 1, spread: 1, aimed: 2, summon: 4, spiral: 0, curtain: 2, turn: 1 };
    this.spiralAngle = 0;
  }

  get healthRatio() {
    return this.health / this.maxHealth;
  }

  static phaseFor(ratio) {
    if (ratio > BOSS_PHASE_THRESHOLDS[0]) return 1;
    if (ratio > BOSS_PHASE_THRESHOLDS[1]) return 2;
    return 3;
  }

  get isInvulnerable() {
    return this.entering || this.phaseShield > 0;
  }

  takeHit(damage) {
    if (!this.alive || this.isInvulnerable) return false;
    const destroyed = super.takeHit(damage);
    const newPhase = Boss.phaseFor(this.healthRatio);
    if (!destroyed && newPhase > this.phase) {
      this.phase = newPhase;
      this.phaseShield = 1.2;
      this.pendingPhase = newPhase;
    }
    return destroyed;
  }

  // The boss never escapes, so it replaces the base update entirely.
  update(dt, world) {
    if (!this.alive) return;
    this.age += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.phaseShield = Math.max(0, this.phaseShield - dt);

    if (this.pendingPhase) {
      world.bus.emit('boss:phase', { phase: this.pendingPhase, boss: this });
      this.pendingPhase = null;
    }

    if (this.entering) {
      this.y = Math.min(this.entryY, this.y + 70 * dt);
      if (this.y >= this.entryY) this.entering = false;
      return;
    }

    this.move(dt);
    this.attackPattern(dt, world);
  }

  move(dt) {
    const settings = PHASE_SETTINGS[this.phase];
    // Phase 3 changes direction at random moments to be less predictable.
    if (this.phase === 3) {
      this.timers.turn -= dt;
      if (this.timers.turn <= 0) {
        this.direction *= -1;
        this.timers.turn = 0.8 + this.rng() * 1.4;
      }
    }
    this.x += this.direction * settings.speed * (this.speed / 90) * dt;
    const half = this.width / 2;
    if (this.x < half || this.x > WORLD_WIDTH - half) {
      this.x = clamp(this.x, half, WORLD_WIDTH - half);
      this.direction *= -1;
    }
  }

  // Counts a timer down and returns true when it fires.
  tick(name, dt, interval) {
    this.timers[name] -= dt;
    if (this.timers[name] > 0) return false;
    this.timers[name] = interval;
    return true;
  }

  attackPattern(dt, world) {
    const s = PHASE_SETTINGS[this.phase];
    const target = this.targetOf(world);
    const rate = this.fireRate;

    if (this.phase === 1) {
      if (this.tick('fan', dt, s.fanInterval / rate)) this.fireFan(world, 5, Math.PI / 3);
      if (target && this.tick('aimed', dt, s.aimedInterval / rate)) this.fireAimedSpread(world, target, 3, 0.15);
    } else if (this.phase === 2) {
      if (this.tick('spread', dt, s.spreadInterval / rate)) this.fireFan(world, 9, Math.PI * 0.75);
      if (target && this.tick('aimed', dt, s.aimedInterval / rate)) this.fireAimedSpread(world, target, 5, 0.12);
      if (this.tick('summon', dt, s.summonInterval)) this.summon(world, ['scout', 'zigzag']);
    } else {
      if (this.tick('spiral', dt, s.spiralInterval / rate)) this.fireSpiral(world);
      if (this.tick('curtain', dt, s.curtainInterval / rate)) this.fireCurtain(world);
      if (this.tick('summon', dt, s.summonInterval)) this.summon(world, ['kamikaze', 'kamikaze']);
    }
  }

  // Bullets spread evenly around "straight down".
  fireFan(world, count, arc) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.PI / 2 - arc / 2 + (arc * i) / (count - 1);
      this.fireDirection(world, angle);
    }
  }

  fireAimedSpread(world, target, count, gap) {
    const base = Math.atan2(target.y - this.y, target.x - this.x);
    for (let i = 0; i < count; i += 1) {
      this.fireDirection(world, base + (i - (count - 1) / 2) * gap, this.projectileSpeed * 1.25, '#ffd166');
    }
  }

  // Two opposite arms of a rotating spiral.
  fireSpiral(world) {
    this.spiralAngle += 0.35;
    this.fireDirection(world, this.spiralAngle, this.projectileSpeed * 0.9, '#f72585');
    this.fireDirection(world, this.spiralAngle + Math.PI, this.projectileSpeed * 0.9, '#f72585');
  }

  // A horizontal wall of bullets with one safe gap the player must find.
  fireCurtain(world) {
    const gapWidth = 150;
    const gapCentre = 120 + this.rng() * (WORLD_WIDTH - 240);
    this.lastCurtainGap = gapCentre;
    for (let x = 15; x < WORLD_WIDTH; x += 30) {
      if (Math.abs(x - gapCentre) < gapWidth / 2) continue;
      world.spawnProjectile(new Projectile({
        x, y: this.y + this.height / 2, vx: 0, vy: 170, radius: 6,
        damage: this.projectileDamage, owner: 'enemy', color: '#ff4d6d',
      }));
    }
  }

  summon(world, types) {
    if (!world.spawnEnemy) return;
    types.forEach((type, i) => {
      const x = clamp(this.x + (i % 2 ? 1 : -1) * (this.width / 2 + 20), 30, WORLD_WIDTH - 30);
      world.spawnEnemy(type, x, this.y);
    });
    world.bus.emit('boss:summon', { types });
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    const flash = this.hitFlash > 0 || (this.phaseShield > 0 && Math.floor(this.age * 20) % 2 === 0);
    const hull = flash ? '#ffffff' : ['#7209b7', '#b5179e', '#f72585'][this.phase - 1];
    ctx.shadowColor = hull;
    ctx.shadowBlur = 25;
    // Saucer body
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.ellipse(0, 10, 110, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    // Dome
    ctx.fillStyle = 'rgba(123, 223, 242, 0.85)';
    ctx.beginPath();
    ctx.ellipse(0, -10, 46, 32, 0, Math.PI, 0);
    ctx.fill();
    // Lights
    ctx.shadowBlur = 8;
    for (let i = -4; i <= 4; i += 1) {
      ctx.fillStyle = (Math.floor(this.age * 6) + i) % 2 ? '#ffd166' : '#39f3c4';
      ctx.beginPath();
      ctx.arc(i * 22, 22, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.isInvulnerable && !this.entering) {
      ctx.strokeStyle = 'rgba(123, 223, 242, 0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 5, 125, 55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
