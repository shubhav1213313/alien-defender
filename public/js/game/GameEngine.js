import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import { Player } from './Player.js';

// Owns the requestAnimationFrame loop. update() advances the simulation by a
// delta time; render() draws the current state. Kept separate so logic can be
// tested without a browser.
export class GameEngine {
  constructor(canvas, input) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.player = new Player();
    this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      speed: 20 + Math.random() * 80,
      size: Math.random() < 0.15 ? 2 : 1,
    }));
    this.lastTime = 0;
    this.running = false;
    this.loop = this.loop.bind(this);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  loop(now) {
    if (!this.running) return;
    // Cap dt so a backgrounded tab does not cause a huge jump on return.
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop);
  }

  update(dt) {
    for (const star of this.stars) {
      star.y += star.speed * dt;
      if (star.y > WORLD_HEIGHT) {
        star.y = 0;
        star.x = Math.random() * WORLD_WIDTH;
      }
    }
    this.player.update(dt, this.input);
  }

  render() {
    const { ctx } = this;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.fillStyle = '#9fb3d9';
    for (const star of this.stars) ctx.fillRect(star.x, star.y, star.size, star.size);
    this.player.draw(ctx);
  }
}
