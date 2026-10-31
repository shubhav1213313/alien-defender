// Lightweight particle effects for explosions, hits and sparks.
export class ParticleSystem {
  constructor(limit = 600) {
    this.particles = [];
    this.limit = limit;
  }

  burst(x, y, { color = '#ffb347', count = 18, speed = 220, life = 0.6, size = 3 } = {}) {
    for (let i = 0; i < count; i += 1) {
      if (this.particles.length >= this.limit) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        size: size * (0.5 + Math.random()),
        color,
      });
    }
  }

  update(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  clear() {
    this.particles = [];
  }
}
