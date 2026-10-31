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
import { AbilityManager } from './AbilityManager.js';

const WAVE_BANNER_SECONDS = 2.5;
const WAVE_CLEAR_BONUS = 500; // x wave number
const FINAL_ARENA_WAVE = 5; // the arena after the boss is a victory bonus
const ENERGY_TO_SCORE = 10; // leftover energy converts to points at the end

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
    this.abilities = new AbilityManager(bus);
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
    if (input && input.on) {
      input.on('pause', () => this.togglePause());
      for (const slot of [1, 2, 3, 4]) input.on(`ability${slot}`, () => this.activateAbility(slot));
    }
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
    this.abilities.reset();
    this.timeFreeze = 0;
    this.shockwaves = [];
    this.arena = null; // { wave, postBoss } while the Knowledge Arena is open
    this.appliedArenaIds = new Set(); // guards against applying rewards twice
    this.stats = {
      enemiesDestroyed: 0, shotsFired: 0, shotsHit: 0, wavesCleared: 0, bossDefeated: false,
      arenaCorrect: 0, arenaQuestions: 0, abilitiesUsed: 0, achievements: [], energyBonus: 0,
    };
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

  // fromShot is false for ability damage so accuracy stats stay honest.
  hitEnemy(enemy, damage, fromShot = true) {
    if (fromShot) this.stats.shotsHit += 1;
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
  // While invisible (Phantom Overdrive) aliens have nothing to aim at.
  get target() {
    return this.player.isInvisible ? null : this.player;
  }

  // ---- Special abilities ----------------------------------------------------

  activateAbility(slot) {
    if (!this.isActive) return { ok: false, reason: 'inactive' };
    const result = this.abilities.activate(slot, this);
    if (result.ok) this.stats.abilitiesUsed += 1;
    return result;
  }

  // EMP Blast / Ultimate Nova: wipes alien bullets and damages every alien.
  shockwave({ damage, bossDamage, color }) {
    this.projectiles = this.projectiles.filter((p) => p.owner === 'player');
    this.shockwaves.push({ x: this.player.x, y: this.player.y, radius: 0, color });
    for (const enemy of [...this.enemies]) {
      if (enemy.alive) this.hitEnemy(enemy, enemy.isBoss ? bossDamage : damage, false);
    }
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

  // Waves 1-4 are followed by the compulsory Knowledge Challenge Arena.
  onWaveComplete(wave, isFinal) {
    this.stats.wavesCleared += 1;
    this.scoreManager.addBonus(WAVE_CLEAR_BONUS * wave, 'wave');
    if (isFinal) {
      this.onAllWavesCleared();
    } else {
      this.openArena(wave);
    }
  }

  // ---- Knowledge Challenge Arena -------------------------------------------
  // The engine only pauses the game and announces 'arena:open'. The arena UI
  // runs the four puzzles via the server, then calls applyArenaRewards() and
  // finishArena(). Combat cannot resume until finishArena() is called.

  openArena(wave, postBoss = false) {
    this.arena = { wave, postBoss };
    this.projectiles = []; // no stray bullets waiting when combat resumes
    if (this.input) this.input.releaseAll();
    this.state.transition(GameState.QUIZ);
    this.bus.emit('arena:open', { wave, postBoss, nextWave: postBoss ? null : wave + 1 });
  }

  // Applies server-calculated rewards once per arena id.
  applyArenaRewards(arenaId, reward) {
    if (!this.state.is(GameState.QUIZ) || !this.arena || this.appliedArenaIds.has(arenaId)) return false;
    this.appliedArenaIds.add(arenaId);
    this.stats.arenaCorrect += reward.correct;
    this.stats.arenaQuestions += reward.total;
    if (reward.energy) this.abilities.addEnergy(reward.energy);
    if (reward.repair) this.player.heal(reward.repair);
    if (reward.ability) this.abilities.unlock(reward.ability.id, reward.ability.tier);
    if (reward.scoreBonus) this.scoreManager.addBonus(reward.scoreBonus, 'arena');
    for (const id of reward.achievements || []) {
      if (!this.stats.achievements.includes(id)) this.stats.achievements.push(id);
    }
    this.bus.emit('arena:rewards', { arenaId, reward });
    return true;
  }

  // Leaves the arena: next wave banner, or - after the boss - final victory.
  // Works whether or not rewards were applied, so a failed or broken
  // challenge can never trap the player.
  finishArena() {
    if (!this.state.is(GameState.QUIZ) || !this.arena) return false;
    const { postBoss } = this.arena;
    this.arena = null;
    this.bus.emit('arena:closed', { postBoss });
    if (postBoss) {
      // Final performance score: leftover Knowledge Energy becomes points.
      const energy = Math.floor(this.abilities.energy);
      if (energy > 0) this.stats.energyBonus = this.scoreManager.addBonus(energy * ENERGY_TO_SCORE, 'energy');
      this.endGame('victory');
    } else {
      this.beginWaveTransition();
    }
    return true;
  }

  // After the fifth wave the Mothership arrives instead of a sixth wave.
  onAllWavesCleared() {
    this.banner = { title: 'WARNING', subtitle: 'Mothership approaching' };
    this.transitionTimer = WAVE_BANNER_SECONDS;
    this.pendingBoss = true;
    this.state.transition(GameState.WAVE_TRANSITION);
  }

  // Called once the boss is destroyed: the post-boss bonus challenge.
  onFinalBattleWon() {
    this.openArena(FINAL_ARENA_WAVE, true);
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
      achievements: [...this.stats.achievements],
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
    this.abilities.update(dt);
    this.timeFreeze = Math.max(0, this.timeFreeze - dt);
    for (const wave of this.shockwaves) wave.radius += 1400 * dt;
    this.shockwaves = this.shockwaves.filter((w) => w.radius < WORLD_WIDTH * 1.2);
    this.player.update(dt, this.input);
    if (this.input.isDown('fire')) {
      const shots = this.player.fire();
      if (shots.length) {
        this.projectiles.push(...shots);
        this.stats.shotsFired += shots.length;
        this.bus.emit('player:fire', { count: shots.length });
      }
    }

    // Time Freeze stops every alien and alien bullet; the player keeps moving.
    const frozen = this.timeFreeze > 0;
    if (!frozen) for (const enemy of this.enemies) enemy.update(dt, this);
    for (const p of this.projectiles) if (!frozen || p.owner === 'player') p.update(dt);

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
      this.drawShockwaves(ctx);
      if (this.timeFreeze > 0) {
        ctx.fillStyle = 'rgba(123, 223, 242, 0.12)';
        ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      }
      this.drawHud(ctx);
      this.drawAbilityBar(ctx);
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

  drawShockwaves(ctx) {
    ctx.save();
    for (const w of this.shockwaves) {
      ctx.globalAlpha = Math.max(0, 1 - w.radius / (WORLD_WIDTH * 1.2));
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Knowledge Energy meter and the four ability slots (keys 1-4).
  drawAbilityBar(ctx) {
    const { abilities } = this;
    const baseY = WORLD_HEIGHT - 58;
    ctx.save();
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.fillStyle = '#e6f1ff';
    ctx.fillText(`KNOWLEDGE ENERGY ${Math.floor(abilities.energy)}/${abilities.maxEnergy}`, WORLD_WIDTH - 236, baseY - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(WORLD_WIDTH - 236, baseY - 4, 220, 6);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(WORLD_WIDTH - 236, baseY - 4, 220 * (abilities.energy / abilities.maxEnergy), 6);

    for (let slot = 1; slot <= 4; slot += 1) {
      const x = WORLD_WIDTH - 236 + (slot - 1) * 56;
      const y = baseY + 6;
      const info = abilities.slotInfo(slot);
      const ready = info && !abilities.blockedReason(slot);
      ctx.fillStyle = info ? 'rgba(13, 22, 48, 0.85)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, 50, 40);
      ctx.strokeStyle = !info ? 'rgba(255,255,255,0.15)' : ready ? '#39f3c4' : 'rgba(255,209,102,0.5)';
      ctx.lineWidth = info && info.tier === 'elite' ? 2.5 : 1;
      ctx.strokeRect(x, y, 50, 40);
      if (info && info.cooldownLeft > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y, 50, 40 * (info.cooldownLeft / info.cooldown));
      }
      ctx.fillStyle = info ? '#e6f1ff' : '#55617a';
      ctx.font = 'bold 12px Segoe UI, sans-serif';
      ctx.fillText(String(slot), x + 4, y + 13);
      ctx.font = '9px Segoe UI, sans-serif';
      if (info) {
        const short = info.name.split(' ').map((w) => w[0]).join('').slice(0, 3);
        ctx.fillText(short + (info.tier === 'enhanced' ? '+' : info.tier === 'elite' ? '★' : ''), x + 18, y + 13);
        ctx.fillText(`${info.cost}⚡`, x + 4, y + 34);
      } else {
        ctx.fillText('locked', x + 12, y + 28);
      }
    }
    ctx.restore();
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
