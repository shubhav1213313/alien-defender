import { WORLD_WIDTH, WORLD_HEIGHT } from './constants.js';
import { Player } from './Player.js';
import { EventBus } from './EventBus.js';
import { GameStateManager, GameState } from './GameStateManager.js';
import { CollisionManager } from './CollisionManager.js';
import { ParticleSystem } from './ParticleSystem.js';
import { EnemyFactory } from './EnemyFactory.js';
import { WaveManager } from './WaveManager.js';
import { ScoreManager } from './ScoreManager.js';
import { getDifficulty } from './DifficultySettings.js';
import { Boss } from './Boss.js';

const WAVE_BANNER_SECONDS = 2.5;
const WAVE_CLEAR_BONUS = 500; // x wave number

// Owns the requestAnimationFrame loop and wires the game systems together.
//   input -> update(dt) -> collision events -> score/wave/state changes -> render()
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
    this.scoreManager = new ScoreManager(bus);
    this.waves = new WaveManager({ bus, spawn: (type, x, y) => this.spawnEnemy(type, x, y) });
    this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * WORLD_WIDTH,
      y: Math.random() * WORLD_HEIGHT,
      speed: 20 + Math.random() * 80,
      size: Math.random() < 0.15 ? 2 : 1,
    }));
    this.lastTime = 0;
    this.running = false;
    this.loop = this.loop.bind(this);

    this.resetWorld(getDifficulty('normal'));
    this.registerEventHandlers();
    if (input && input.on) input.on('pause', () => this.togglePause());
  }

  get score() {
    return this.scoreManager.score;
  }

  resetWorld(difficulty) {
    this.difficulty = difficulty;
    this.enemyFactory = new EnemyFactory({ modifiers: difficulty.enemyModifiers });
    this.scoreManager.reset(difficulty.scoreMultiplier);
    this.waves.reset(difficulty.spawnInterval);
    this.player = new Player();
    this.earth = { shield: difficulty.earthShield, maxShield: difficulty.earthShield };
    this.projectiles = [];
    this.enemies = [];
    this.particles.clear();
    this.damageFlash = 0;
    this.elapsed = 0;
    this.banner = null;
    this.transitionTimer = 0;
    this.resumeState = GameState.PLAYING;
    this.boss = null;
    this.pendingBoss = false;
    this.alert = null; // short centre-screen message, e.g. "PHASE 2"
    this.stats = { enemiesDestroyed: 0, shotsFired: 0, shotsHit: 0, wavesCleared: 0, bossDefeated: false };
  }

  // Event-driven reactions. Other systems (HUD, audio, achievements) can
  // subscribe to the same events independently.
  registerEventHandlers() {
    const { bus } = this;
    bus.on('collision:playerHit', ({ damage }) => this.damagePlayer(damage));
    bus.on('collision:enemyHit', ({ projectile, enemy }) => this.hitEnemy(enemy, projectile.damage));
    // Ramming the player destroys the alien (no points) and hurts the player.
    // The boss survives a collision; ordinary aliens do not.
    bus.on('collision:playerRammed', ({ enemy, damage }) => {
      if (!enemy.isBoss) {
        enemy.alive = false;
        this.particles.burst(enemy.x, enemy.y, { color: enemy.color, count: 24 });
      }
      this.damagePlayer(damage);
    });
    bus.on('boss:phase', ({ phase, boss }) => {
      this.alert = { text: `PHASE ${phase}`, timer: 1.5 };
      this.damageFlash = Math.max(this.damageFlash, 0.2);
      this.particles.burst(boss.x, boss.y, { color: '#f72585', count: 80, speed: 380, life: 1 });
    });
    bus.on('enemy:escaped', ({ enemy }) => this.damageEarth(enemy.escapeDamage));
    bus.on('wave:complete', ({ wave, isFinal }) => this.onWaveComplete(wave, isFinal));
  }

  // ---- World interactions --------------------------------------------------

  // Used by enemies to fire bullets into the world.
  spawnProjectile(projectile) {
    this.projectiles.push(projectile);
  }

  spawnEnemy(type, x, y) {
    const enemy = this.enemyFactory.create(type, x, y);
    this.enemies.push(enemy);
    return enemy;
  }

  hitEnemy(enemy, damage) {
    this.stats.shotsHit += 1;
    const destroyed = enemy.takeHit(damage);
    this.particles.burst(enemy.x, enemy.y, { color: '#ffffff', count: 4, speed: 120, life: 0.25, size: 2 });
    if (!destroyed) return;
    this.stats.enemiesDestroyed += 1;
    this.particles.burst(enemy.x, enemy.y, { color: enemy.color, count: 26, speed: 260 });
    // ScoreManager listens for this event and awards (combo-scaled) points.
    this.bus.emit('enemy:destroyed', { enemy, type: enemy.type, points: enemy.points });
    if (enemy.isBoss) this.onBossDefeated(enemy);
  }

  // The engine is the "world" enemies see; `target` is who they aim at.
  get target() {
    return this.player;
  }

  spawnBoss() {
    this.boss = new Boss({ x: WORLD_WIDTH / 2, y: -80, modifiers: this.difficulty.enemyModifiers });
    this.enemies.push(this.boss);
    this.bus.emit('boss:spawn', { maxHealth: this.boss.maxHealth });
  }

  onBossDefeated(boss) {
    this.stats.bossDefeated = true;
    // Spectacular chain of explosions; remaining escorts and bullets vanish.
    for (let i = 0; i < 6; i += 1) {
      this.particles.burst(boss.x + (Math.random() - 0.5) * boss.width, boss.y + (Math.random() - 0.5) * boss.height,
        { color: ['#f72585', '#ffd166', '#7bdff2'][i % 3], count: 50, speed: 420, life: 1.4 });
    }
    for (const e of this.enemies) if (e !== boss) e.alive = false;
    this.projectiles = this.projectiles.filter((p) => p.owner === 'player');
    this.bus.emit('boss:defeated', { score: this.score });
    this.onFinalBattleWon();
  }

  damagePlayer(baseAmount) {
    if (!this.isActive) return;
    const amount = baseAmount * this.difficulty.playerDamageTaken;
    const result = this.player.takeDamage(amount);
    if (result.ignored) return;
    this.damageFlash = 0.25;
    this.particles.burst(this.player.x, this.player.y, { color: '#ff4d6d', count: 12 });
    this.bus.emit('player:damaged', { ...result, health: this.player.health, shield: this.player.shield });
    if (this.player.isDead) {
      this.particles.burst(this.player.x, this.player.y, { color: '#ffb347', count: 60, speed: 320, life: 1.2 });
      this.endGame('destroyed');
    }
  }

  damageEarth(amount) {
    if (!this.isActive) return;
    this.earth.shield = Math.max(0, this.earth.shield - amount);
    this.damageFlash = Math.max(this.damageFlash, 0.15);
    this.bus.emit('earth:damaged', { amount, shield: this.earth.shield });
    if (this.earth.shield <= 0) this.endGame('earthFallen');
  }

  // ---- Flow control -------------------------------------------------------

  get isActive() {
    return this.state.is(GameState.PLAYING) || this.state.is(GameState.WAVE_TRANSITION);
  }

  // A new game can only start from the menu or an end screen. Returns false
  // otherwise, e.g. Enter pressed mid-game or a key + button click both
  // firing for the same press.
  startGame(difficultyId = 'normal') {
    const startable = [GameState.MENU, GameState.GAME_OVER, GameState.VICTORY];
    if (!startable.includes(this.state.state)) return false;
    this.resetWorld(getDifficulty(difficultyId));
    this.state.transition(GameState.PLAYING);
    this.bus.emit('game:start', { difficulty: this.difficulty.id });
    this.beginWaveTransition();
    return true;
  }

  // Shows the "WAVE N" banner, then launches the wave when the timer runs out.
  beginWaveTransition() {
    const next = this.waves.nextWave;
    this.banner = { title: `WAVE ${this.waves.waveNumber + 1}`, subtitle: next.name };
    this.transitionTimer = WAVE_BANNER_SECONDS;
    this.state.transition(GameState.WAVE_TRANSITION);
  }

  onWaveComplete(wave, isFinal) {
    this.stats.wavesCleared += 1;
    this.scoreManager.addBonus(WAVE_CLEAR_BONUS * wave, 'wave');
    if (isFinal) {
      this.onAllWavesCleared();
    } else {
      this.beginWaveTransition();
    }
  }

  // After the fifth wave the Mothership arrives instead of a sixth wave.
  onAllWavesCleared() {
    this.banner = { title: 'WARNING', subtitle: 'Mothership approaching' };
    this.transitionTimer = WAVE_BANNER_SECONDS;
    this.pendingBoss = true;
    this.state.transition(GameState.WAVE_TRANSITION);
  }

  // Called once the boss is destroyed.
  onFinalBattleWon() {
    this.endGame('victory');
  }

  endGame(reason) {
    const summary = this.summary(reason);
    if (reason === 'victory') {
      this.state.transition(GameState.VICTORY);
      this.bus.emit('game:victory', summary);
    } else {
      this.state.transition(GameState.GAME_OVER);
      this.bus.emit('game:over', summary);
    }
  }

  summary(reason) {
    return {
      reason,
      difficulty: this.difficulty.id,
      score: this.score,
      wave: this.waves.waveNumber,
      maxCombo: this.scoreManager.maxCombo,
      survivedSeconds: this.elapsed,
      ...this.stats,
    };
  }

  togglePause() {
    if (this.isActive) {
      this.resumeState = this.state.state;
      this.state.transition(GameState.PAUSED);
      if (this.input) this.input.releaseAll();
    } else if (this.state.is(GameState.PAUSED)) {
      this.state.transition(this.resumeState);
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
    // Particles keep animating on end screens for a nicer explosion.
    this.particles.update(dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    if (!this.state.isSimulating) return;
    if (this.alert) {
      this.alert.timer -= dt;
      if (this.alert.timer <= 0) this.alert = null;
    }

    this.elapsed += dt;
    this.scoreManager.update(dt);
    this.player.update(dt, this.input);
    if (this.input.isDown('fire')) {
      const shots = this.player.fire();
      if (shots.length) {
        this.projectiles.push(...shots);
        this.stats.shotsFired += shots.length;
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

    if (this.state.is(GameState.WAVE_TRANSITION)) {
      this.transitionTimer -= dt;
      if (this.transitionTimer <= 0) {
        this.banner = null;
        this.state.transition(GameState.PLAYING);
        if (this.pendingBoss) {
          this.pendingBoss = false;
          this.spawnBoss();
        } else {
          this.waves.startNextWave();
        }
      }
    } else if (this.state.is(GameState.PLAYING)) {
      this.waves.update(dt, this.enemies.length);
    }
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
      this.drawEarthLine(ctx);
      for (const enemy of this.enemies) enemy.draw(ctx);
      for (const p of this.projectiles) p.draw(ctx);
      if (!this.player.isDead) this.player.draw(ctx);
      this.particles.draw(ctx);
      this.drawHud(ctx);
      if (this.boss && this.boss.alive) this.drawBossBar(ctx);
      if (this.banner) this.drawBanner(ctx);
      if (this.alert) this.drawAlert(ctx);
    }

    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(255, 40, 70, ${this.damageFlash * 1.2})`;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
  }

  // Glowing line at the bottom representing Earth's defence shield.
  drawEarthLine(ctx) {
    const strength = this.earth.shield / this.earth.maxShield;
    ctx.save();
    ctx.strokeStyle = `rgba(80, 170, 255, ${0.2 + strength * 0.6})`;
    ctx.shadowColor = '#50aaff';
    ctx.shadowBlur = 12 * strength;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, WORLD_HEIGHT - 2);
    ctx.lineTo(WORLD_WIDTH, WORLD_HEIGHT - 2);
    ctx.stroke();
    ctx.restore();
  }

  drawHud(ctx) {
    const bar = (x, y, label, value, max, color) => {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, 180, 10);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 180 * Math.max(0, value / max), 10);
      ctx.fillStyle = '#e6f1ff';
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.fillText(`${label} ${Math.ceil(value)}/${max}`, x, y - 4);
    };
    bar(16, 26, 'HULL', this.player.health, this.player.maxHealth, '#39f3c4');
    bar(16, 56, 'SHIELD', this.player.shield, this.player.maxShield, '#50aaff');
    bar(16, 86, 'EARTH', this.earth.shield, this.earth.maxShield, '#7bdff2');

    ctx.textAlign = 'right';
    ctx.fillStyle = '#e6f1ff';
    ctx.font = 'bold 20px Segoe UI, sans-serif';
    ctx.fillText(`SCORE ${this.score.toLocaleString()}`, WORLD_WIDTH - 16, 34);
    const { combo, multiplier } = this.scoreManager;
    if (combo > 1) {
      ctx.fillStyle = multiplier > 1 ? '#ffd166' : '#9fb3d9';
      ctx.font = 'bold 15px Segoe UI, sans-serif';
      ctx.fillText(`COMBO ${combo}  x${multiplier.toFixed(1)}`, WORLD_WIDTH - 16, 56);
    }

    // Wave counter and progress bar, centred at the top.
    if (this.waves.waveNumber > 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9fb3d9';
      ctx.font = '13px Segoe UI, sans-serif';
      ctx.fillText(`WAVE ${this.waves.waveNumber}/${this.waves.totalWaves} · ${this.difficulty.label.toUpperCase()}`, WORLD_WIDTH / 2, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(WORLD_WIDTH / 2 - 100, 30, 200, 4);
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(WORLD_WIDTH / 2 - 100, 30, 200 * this.waves.progress, 4);
    }
    ctx.textAlign = 'left';
  }

  drawBossBar(ctx) {
    const { boss } = this;
    const width = 420;
    const x = (WORLD_WIDTH - width) / 2;
    const y = 50;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, width, 12);
    ctx.fillStyle = ['#7209b7', '#b5179e', '#f72585'][boss.phase - 1];
    ctx.fillRect(x, y, width * boss.healthRatio, 12);
    // Phase markers at 67% and 33%.
    ctx.fillStyle = '#e6f1ff';
    ctx.fillRect(x + width / 3, y - 2, 2, 16);
    ctx.fillRect(x + (width * 2) / 3, y - 2, 2, 16);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.fillText(`MOTHERSHIP · PHASE ${boss.phase}/3`, WORLD_WIDTH / 2, y - 6);
    ctx.restore();
  }

  drawAlert(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.alert.timer / 0.4);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f72585';
    ctx.shadowColor = '#f72585';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 44px Segoe UI, sans-serif';
    ctx.fillText(this.alert.text, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    ctx.restore();
  }

  drawBanner(ctx) {
    const fade = Math.min(1, this.transitionTimer / 0.5, (WAVE_BANNER_SECONDS - this.transitionTimer) / 0.3);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#39f3c4';
    ctx.shadowColor = '#39f3c4';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 54px Segoe UI, sans-serif';
    ctx.fillText(this.banner.title, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#e6f1ff';
    ctx.font = '22px Segoe UI, sans-serif';
    ctx.fillText(this.banner.subtitle, WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 28);
    ctx.restore();
  }
}
