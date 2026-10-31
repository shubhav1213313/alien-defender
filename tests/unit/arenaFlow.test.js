import { GameEngine } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';
import { AbilityManager } from '../../public/js/game/AbilityManager.js';
import { ABILITIES, abilityStats } from '../../public/js/game/AbilityDefinitions.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { Projectile } from '../../public/js/game/Projectile.js';
const { calculateRewards, WAVE_ABILITIES } = require('../../src/services/arenaRules');

function fakeInput() {
  const held = new Set();
  const listeners = {};
  return {
    held,
    isDown: (a) => held.has(a),
    on: (a, cb) => { (listeners[a] ||= []).push(cb); },
    press: (a) => (listeners[a] || []).forEach((cb) => cb()),
    releaseAll: () => held.clear(),
  };
}

// An engine sitting in the arena that follows wave `wave`.
function engineInArena(wave = 1) {
  const input = fakeInput();
  const engine = new GameEngine({ input });
  engine.startGame('normal');
  // Play through the opening banners so `wave` is genuinely the current wave.
  while (engine.waves.waveNumber < wave) {
    engine.update(engine.transitionTimer + 0.01);
    if (engine.waves.waveNumber < wave) engine.beginWaveTransition();
  }
  engine.openArena(wave);
  return { engine, input };
}

const reward = (correct, difficulty = 'normal', wave = 1) => calculateRewards({ wave, difficulty, correct });

describe('Knowledge Arena flow in the engine', () => {
  test('combat is frozen while the arena is open', () => {
    const { engine, input } = engineInArena();
    expect(engine.state.state).toBe(GameState.QUIZ);
    input.held.add('right');
    const x = engine.player.x;
    engine.update(0.5);
    expect(engine.player.x).toBe(x);
  });

  test('the arena cannot be bypassed with pause, Enter or ability keys', () => {
    const { engine, input } = engineInArena();
    input.press('pause');
    input.press('confirm');
    input.press('ability1');
    expect(engine.state.state).toBe(GameState.QUIZ);
    expect(engine.startGame()).toBe(false);
  });

  test('stray bullets are cleared when the arena opens', () => {
    const input = fakeInput();
    const engine = new GameEngine({ input });
    engine.startGame();
    engine.projectiles.push(new Projectile({ x: 10, y: 10, owner: 'enemy' }));
    engine.openArena(1);
    expect(engine.projectiles).toHaveLength(0);
  });

  test.each([
    [0, { energy: 0, health: 70, slots: 0 }],
    [1, { energy: 10, health: 70, slots: 0 }],
    [2, { energy: 20, health: 85, slots: 0 }],
    [3, { energy: 20, health: 85, slots: 1 }],
    [4, { energy: 35, health: 95, slots: 1 }],
  ])('%i/4 rewards are applied to the game', (correct, expected) => {
    const { engine } = engineInArena(2);
    engine.player.health = 70;
    engine.applyArenaRewards('a1', reward(correct, 'normal', 2));
    expect(engine.abilities.energy).toBe(expected.energy);
    expect(engine.player.health).toBe(expected.health);
    expect(engine.abilities.slots.size).toBe(expected.slots);
  });

  test('the same arena rewards cannot be applied twice', () => {
    const { engine } = engineInArena();
    expect(engine.applyArenaRewards('a1', reward(2))).toBe(true);
    expect(engine.applyArenaRewards('a1', reward(2))).toBe(false);
    expect(engine.abilities.energy).toBe(20);
  });

  test('rewards cannot be applied outside an open arena', () => {
    const engine = new GameEngine({ input: fakeInput() });
    engine.startGame();
    expect(engine.applyArenaRewards('a1', reward(4))).toBe(false);
  });

  test('finishing a 0/4 arena still continues to the next wave', () => {
    const { engine } = engineInArena(1);
    engine.applyArenaRewards('a1', reward(0));
    expect(engine.finishArena()).toBe(true);
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.banner.title).toBe('WAVE 2');
  });

  test('finishing works even if rewards were never applied (e.g. server unreachable)', () => {
    const { engine } = engineInArena(1);
    expect(engine.finishArena()).toBe(true);
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.finishArena()).toBe(false); // second call ignored
  });

  test('post-boss arena converts leftover energy into final score, then victory', () => {
    const input = fakeInput();
    const engine = new GameEngine({ input });
    const victory = jest.fn();
    engine.bus.on('game:victory', victory);
    engine.startGame('hard');
    engine.openArena(5, true);
    const before = engine.score;
    engine.applyArenaRewards('final', calculateRewards({ wave: 5, difficulty: 'hard', correct: 4 }));
    // Hard 4/4: 4 x 500 x 2 score bonus (x1.5 game difficulty) + 40 energy
    expect(engine.score).toBe(before + Math.round(4000 * 1.5));
    engine.finishArena();
    expect(engine.state.state).toBe(GameState.VICTORY);
    expect(engine.stats.energyBonus).toBe(Math.round(40 * 10 * 1.5));
    expect(victory).toHaveBeenCalledWith(expect.objectContaining({ achievements: ['legendary_defender'], arenaCorrect: 4 }));
  });
});

describe('AbilityManager', () => {
  let bus;
  let abilities;
  beforeEach(() => {
    bus = new EventBus();
    abilities = new AbilityManager(bus);
  });

  test('energy is capped at 100', () => {
    abilities.addEnergy(80);
    expect(abilities.addEnergy(50)).toBe(20);
    expect(abilities.energy).toBe(100);
  });

  test('locked slots, cooldowns and missing energy block activation', () => {
    const engine = { player: { addShield: jest.fn() } };
    expect(abilities.activate(1, engine)).toEqual({ ok: false, reason: 'locked' });
    abilities.unlock('miniShield', 'standard');
    expect(abilities.activate(1, engine)).toEqual({ ok: false, reason: 'energy' });
    abilities.addEnergy(50);
    expect(abilities.activate(1, engine)).toEqual({ ok: true });
    expect(abilities.energy).toBe(30);
    expect(abilities.activate(1, engine)).toEqual({ ok: false, reason: 'cooldown' });
    abilities.update(ABILITIES.miniShield.cooldown);
    expect(abilities.activate(1, engine)).toEqual({ ok: true });
    expect(engine.player.addShield).toHaveBeenCalledTimes(2);
  });

  test('slots upgrade (standard -> enhanced -> elite) but never downgrade', () => {
    abilities.unlock('rapidFire', 'standard');
    abilities.unlock('rapidFire', 'enhanced');
    expect(abilities.slots.get(2)).toEqual({ id: 'rapidFire', tier: 'enhanced' });
    abilities.unlock('phantomOverdrive', 'elite');
    expect(abilities.unlock('rapidFire', 'standard')).toBe(false);
    expect(abilities.slots.get(2)).toEqual({ id: 'phantomOverdrive', tier: 'elite' });
  });

  test('enhanced tier is cheaper and lasts longer', () => {
    const std = abilityStats('rapidFire', 'standard');
    const enh = abilityStats('rapidFire', 'enhanced');
    expect(enh.cost).toBeLessThan(std.cost);
    expect(enh.duration).toBeGreaterThan(std.duration);
  });

  test('every ability offered by the server exists in the game, in the right slot', () => {
    for (const [wave, { standard, elite }] of Object.entries(WAVE_ABILITIES)) {
      expect(ABILITIES[standard].slot).toBe(Number(wave));
      expect(ABILITIES[elite].slot).toBe(Number(wave));
      expect(ABILITIES[elite].cost).toBeGreaterThan(ABILITIES[standard].cost);
    }
  });
});

describe('Ability effects in combat', () => {
  function armed(abilityId, tier = 'standard') {
    const input = fakeInput();
    const engine = new GameEngine({ input });
    engine.startGame();
    engine.abilities.unlock(abilityId, tier);
    engine.abilities.addEnergy(100);
    return { engine, input, slot: ABILITIES[abilityId].slot };
  }

  test('abilities only work during combat, via keys 1-4', () => {
    const { engine, input } = armed('miniShield');
    engine.player.shield = 0;
    input.press('ability1');
    expect(engine.player.shield).toBe(25);
    engine.openArena(1);
    expect(engine.activateAbility(1)).toEqual({ ok: false, reason: 'inactive' });
  });

  test('Ghost Mode makes the player immune to damage', () => {
    const { engine, slot } = armed('ghostMode', 'elite');
    engine.activateAbility(slot);
    engine.damagePlayer(500);
    expect(engine.player.health).toBe(100);
  });

  test('Rapid Fire shortens the fire cooldown', () => {
    const { engine, slot } = armed('rapidFire');
    engine.activateAbility(slot);
    engine.player.fire();
    expect(engine.player.cooldownTimer).toBeCloseTo(engine.player.fireCooldown * 0.4);
  });

  test('Phantom Overdrive hides the player from aimed attacks', () => {
    const { engine, slot } = armed('phantomOverdrive', 'elite');
    expect(engine.target).toBe(engine.player);
    engine.activateAbility(slot);
    expect(engine.target).toBeNull();
  });

  test('Triple Laser fires three projectiles per shot', () => {
    const { engine, slot } = armed('tripleLaser');
    engine.activateAbility(slot);
    expect(engine.player.fire()).toHaveLength(3);
  });

  test('Time Freeze stops aliens and their bullets', () => {
    const { engine, slot } = armed('timeFreezeLaser', 'elite');
    const tank = engine.spawnEnemy('armored', 300, 100);
    engine.projectiles.push(new Projectile({ x: 50, y: 50, vy: 100, owner: 'enemy' }));
    engine.activateAbility(slot);
    engine.update(0.5);
    expect(tank.y).toBe(100);
    expect(engine.projectiles.find((p) => p.owner === 'enemy').y).toBe(50);
  });

  test('EMP Blast clears alien bullets and damages every alien', () => {
    const { engine, slot } = armed('empBlast');
    const scout = engine.spawnEnemy('scout', 100, 100);
    const tank = engine.spawnEnemy('armored', 300, 100);
    engine.projectiles.push(new Projectile({ x: 50, y: 50, owner: 'enemy' }));
    engine.activateAbility(slot);
    expect(scout.alive).toBe(false);
    expect(tank.health).toBe(tank.maxHealth - 3);
    expect(engine.projectiles.some((p) => p.owner === 'enemy')).toBe(false);
    expect(engine.stats.shotsHit).toBe(0); // ability hits do not inflate accuracy
  });

  test('Ultimate Nova hits harder than EMP Blast', () => {
    const { engine, slot } = armed('ultimateNova', 'elite');
    const tank = engine.spawnEnemy('armored', 300, 100);
    engine.activateAbility(slot);
    expect(tank.alive).toBe(false);
    expect(engine.player.isGhost).toBe(true);
  });
});
