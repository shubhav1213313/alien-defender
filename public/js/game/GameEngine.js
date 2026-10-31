import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import { Player } from './Player.js';
import { EventBus } from './EventBus.js';
import { GameStateManager, GameState } from './GameStateManager.js';
import { CollisionManager } from './CollisionManager.js';
import { ParticleSystem } from './ParticleSystem.js';

// Owns the requestAnimationFrame loop and wires the game systems together.
//   input  -> update(dt) -> collision events -> state changes -> render()
// update() never touches the canvas, so the whole simulation can be driven
// from Jest by calling update() with a fixed dt.
export class GameEngine {
  constructor({ canvas = null, input, bus = new EventBus() }) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.input = input;
    this.bus = bus;
    this.state = new GameStateManager(bus);
    this.collisions = new CollisionManager(bus);
    this.particles = new ParticleSystem();
    this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      speed: 20 + Math.random() * 80,
      size: Math.random() < 0.15 ? 2 : 1,
    }));
    this.damageFlash = 0;
    this.lastTime = 0;
    this.running = false;
    this.loop = this.loop.bind(this);

    this.resetWorld();
    this.registerEventHandlers();
    if (input && input.on) input.on('pause', () => this.togglePause());
  }

  resetWorld() {
    this.player = new Player();
    this.projectiles = [];
    this.enemies = [];
    this.particles.clear();
    this.damageFlash = 0;
    this.elapsed = 0;
  }

  // Event-driven reactions to collisions. Other systems (HUD, audio,
  // achievements) can subscribe to the same events independently.
  registerEventHandlers() {
    const hurtPlayer = ({ damage }) => this.damagePlayer(damage);
    this.bus.on('collision:playerHit', hurtPlayer);
    this.bus.on('collision:playerRammed', hurtPlayer);
  }

  damagePlayer(amount) {
    const result = this.player.takeDamage(amount);
    if (result.ignored) return;
    this.damageFlash = 0.25;
    this.particles.burst(this.player.x, this.player.y, { color: '#ff4d6d', count: 12 });
    this.bus.emit('player:damaged', { ...result, health: this.player.health, shield: this.player.shield });
    if (this.player.isDead) {
      this.particles.burst(this.player.x, this.player.y, { color: '#ffb347', count: 60, speed: 320, life: 1.2 });
      this.state.transition(GameState.GAME_OVER);
      this.bus.emit('game:over', { survivedSeconds: this.elapsed });
    }
  }

  // ---- Flow control -------------------------------------------------------

  // Returns false if a game cannot be started from the current state (e.g. a
  // keyboard shortcut and a button click both firing for the same press).
  startGame() {
    if (!this.state.canTransition(GameState.PLAYING) || this.state.is(GameState.PAUSED)) return false;
    this.resetWorld();
    this.state.transition(GameState.PLAYING);
    this.bus.emit('game:start', {});
    return true;
  }

  togglePause() {
    if (this.state.is(GameState.PLAYING)) {
      this.state.transition(GameState.PAUSED);
      if (this.input) this.input.releaseAll();
    } else if (this.state.is(GameState.PAUSED)) {
      this.state.transition(GameState.PLAYING);
    }
  }

  quitToMenu() {
    this.state.tryTransition(GameState.MENU);
  }

  // ---- Loop ---------------------------------------------------------------

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
    this.updateStars(dt);
    // Particles keep animating on the game-over screen for a nicer explosion.
    this.particles.update(dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    if (!this.state.isSimulating) return;

    this.elapsed += dt;
    this.player.update(dt, this.input);
    if (this.input.isDown('fire')) {
      const shots = this.player.fire();
      if (shots.length) {
        this.projectiles.push(...shots);
        this.bus.emit('player:fire', { count: shots.length });
      }
    }

    for (const enemy of this.enemies) enemy.update(dt, this);
    for (const p of this.projectiles) p.update(dt);

    this.collisions.checkPlayerProjectiles(this.projectiles, this.enemies);
    this.collisions.checkEnemyProjectiles(this.projectiles, this.player);
    if (!this.player.isInvulnerable) this.collisions.checkEnemyContact(this.enemies, this.player);

    // Remove spent bullets and dead enemies.
    this.projectiles = this.projectiles.filter((p) => p.active);
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  updateStars(dt) {
    for (const star of this.stars) {
      star.y += star.speed * dt;
      if (star.y > WORLD_HEIGHT) {
        star.y = 0;
        star.x = Math.random() * WORLD_WIDTH;
      }
    }
  }

  // ---- Rendering ----------------------------------------------------------

  render() {
    const { ctx } = this;
    if (!ctx) return;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.fillStyle = '#9fb3d9';
    for (const star of this.stars) ctx.fillRect(star.x, star.y, star.size, star.size);

    if (!this.state.is(GameState.MENU)) {
      for (const enemy of this.enemies) enemy.draw(ctx);
      for (const p of this.projectiles) p.draw(ctx);
      if (!this.player.isDead) this.player.draw(ctx);
      this.particles.draw(ctx);
      this.drawHud(ctx);
    }

    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(255, 40, 70, ${this.damageFlash * 1.2})`;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
  }

  drawHud(ctx) {
    const bar = (x, y, label, value, max, color) => {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, 180, 10);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 180 * (value / max), 10);
      ctx.fillStyle = '#e6f1ff';
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillText(`${label} ${Math.ceil(value)}/${max}`, x, y - 4);
    };
    bar(16, 26, 'HULL', this.player.health, this.player.maxHealth, '#39f3c4');
    bar(16, 56, 'SHIELD', this.player.shield, this.player.maxShield, '#50aaff');
  }
}
