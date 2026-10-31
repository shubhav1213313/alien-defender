import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';

// A bullet fired by the player or an enemy. `owner` decides what it can hit.
export class Projectile {
  constructor({ x, y, vx = 0, vy = -600, radius = 4, damage = 1, owner = 'player', color }) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.radius = radius;
    this.damage = damage;
    this.owner = owner;
    this.color = color || (owner === 'player' ? '#39f3c4' : '#ff4d6d');
    this.active = true;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.isOffscreen()) this.active = false;
  }

  isOffscreen(margin = 20) {
    return (
      this.x < -margin || this.x > WORLD_WIDTH + margin ||
      this.y < -margin || this.y > WORLD_HEIGHT + margin
    );
  }

  draw(ctx) {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    if (this.owner === 'player') {
      ctx.ellipse(this.x, this.y, this.radius * 0.7, this.radius * 2.2, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }
}
