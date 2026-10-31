import { GameEngine, SPECIAL_OFFER, VOID_STORM } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';
import { AbilityManager } from '../../public/js/game/AbilityManager.js';
import { ABILITIES } from '../../public/js/game/AbilityDefinitions.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { Projectile } from '../../public/js/game/Projectile.js';
const { calculateRewards, WAVE_ABILITIES, SPECIAL_ABILITY } = require('../../src/services/arenaRules');

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

const step = (engine, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) engine.update(1 / 60); };

// An engine in combat during wave `wave` (banners played through).
function engineInWave(wave = 1, rng = () => 0.99) {
  const input = fakeInput();
  const engine = new GameEngine({ input, rng });
  engine.startGame('normal');
  while (engine.waves.waveNumber < wave) {
    engine.update(engine.transitionTimer + 0.01);
    if (engine.waves.waveNumber < wave) engine.beginWaveTransition();
  }
  return { engine, input };
}

function engineInQuiz(wave = 1) {
  const ctx = engineInWave(wave);
  ctx.engine.openArena(wave);
  return ctx;
}

const waveReward = (correct, wave = 1) => calculateRewards({ kind: 'wave', wave, correct });

describe('Compulsory quiz after each wave (no Upgrade Bay)', () => {
  test('clearing a wave stops combat and opens the 2-puzzle quiz automatically', () => {
    const { engine } = engineInWave(1);
    const opened = jest.fn();
    engine.bus.on('arena:open', opened);
    for (const e of engine.enemies) e.alive = false;
    engine.waves.queue = [];
    engine.waves.kills = engine.waves.requiredKills; // the player destroyed enough aliens
    engine.update(0.016);
    expect(engine.state.state).toBe(GameState.QUIZ);
    expect(opened).toHaveBeenCalledWith({ kind: 'wave', wave: 1, postBoss: false, nextWave: 2 });
  });

  test('combat is frozen during the quiz', () => {
    const { engine, input } = engineInQuiz();
    input.held.add('right');
    const x = engine.player.x;
    engine.update(0.5);
    expect(engine.player.x).toBe(x);
  });

  test('the quiz cannot be bypassed with pause, Enter or ability keys', () => {
    const { engine, input } = engineInQuiz();
    input.press('pause');
    input.press('confirm');
    for (const k of [1, 2, 3, 4, 5]) input.press(`ability${k}`);
    expect(engine.state.state).toBe(GameState.QUIZ);
    expect(engine.startGame()).toBe(false);
  });

  test.each([1, 2, 3, 4])('wave %i: 2/2 unlocks its ability, then the next wave starts', (wave) => {
    const { engine } = engineInQuiz(wave);
    engine.applyArenaRewards(`q${wave}`, waveReward(2, wave));
    expect(engine.abilities.has(WAVE_ABILITIES[wave])).toBe(true);
    engine.finishArena();
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.banner.title).toBe(`WAVE ${wave + 1} STARTING`);
  });

  test.each([0, 1])('%i/2 unlocks nothing but the next wave still starts', (correct) => {
    const { engine } = engineInQuiz(1);
    engine.applyArenaRewards('q', waveReward(correct));
    expect(engine.abilities.slots.size).toBe(0);
    expect(engine.abilities.energy).toBe(correct * 15);
    expect(engine.finishArena()).toBe(true);
    expect(engine.banner.title).toBe('WAVE 2 STARTING');
  });

  test('rewards apply once per challenge id', () => {
    const { engine } = engineInQuiz();
    expect(engine.applyArenaRewards('q', waveReward(2))).toBe(true);
    expect(engine.applyArenaRewards('q', waveReward(2))).toBe(false);
    expect(engine.abilities.energy).toBe(30);
  });

  test('"Continue without ability" (API down) still moves on, exactly once', () => {
    const { engine } = engineInQuiz();
    expect(engine.finishArena()).toBe(true);
    expect(engine.finishArena()).toBe(false);
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
  });

  test('after the boss: Victory Bonus Challenge, then victory', () => {
    const { engine } = engineInWave(1);
    const victory = jest.fn();
    engine.bus.on('game:victory', victory);
    engine.openArena(5, true);
    engine.applyArenaRewards('bonus', calculateRewards({ kind: 'bonus', wave: 5, difficulty: 'hard', correct: 2 }));
    engine.finishArena();
    expect(engine.state.state).toBe(GameState.VICTORY);
    expect(victory).toHaveBeenCalledWith(expect.objectContaining({ achievements: ['legendary_defender'] }));
  });
});

describe('Optional special puzzle invitation', () => {
  // rng: first call decides whether this wave gets an offer, second its time.
  const OFFER_AT = SPECIAL_OFFER.earliest + 0.5 * (SPECIAL_OFFER.latest - SPECIAL_OFFER.earliest);
  function waveWithOffer() {
    const values = [0, 0.5]; // offer: yes, at earliest + 50% of the window
    return engineInWave(1, () => (values.length ? values.shift() : 0.99));
  }

  test('appears during combat, lasts 4 s of combat time, then disappears harmlessly', () => {
    const offers = [];
    const { engine } = engineInWave(1, () => 0); // scheduled at the earliest time
    // wave 1 was scheduled before we subscribed; schedule again with rng 0
    engine.scheduleSpecialOffer();
    engine.bus.on('special:offer', (o) => offers.push(o));
    const expired = jest.fn();
    engine.bus.on('special:expired', expired);
    engine.player.maxHealth = engine.player.health = 1e9;
    step(engine, SPECIAL_OFFER.earliest + 0.1);
    expect(offers).toEqual([{ seconds: 4, abilityName: 'VOID STORM' }]);
    expect(engine.specialOffer).not.toBeNull();
    step(engine, 4.1);
    expect(engine.specialOffer).toBeNull();
    expect(expired).toHaveBeenCalled();
    expect(engine.state.state).toBe(GameState.PLAYING); // combat simply continued
  });

  test('clicking within 4 s pauses combat and opens ONE special puzzle; finishing returns to the same wave', () => {
    const { engine } = waveWithOffer();
    engine.player.maxHealth = engine.player.health = 1e9;
    const opened = jest.fn();
    engine.bus.on('arena:open', opened);
    step(engine, OFFER_AT + 0.5); // invitation visible (it lasts 4 s)
    expect(engine.specialOffer).not.toBeNull();
    expect(engine.acceptSpecialOffer()).toBe(true);
    expect(engine.state.state).toBe(GameState.QUIZ);
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ kind: 'special', wave: 1 }));
    engine.applyArenaRewards('s', calculateRewards({ kind: 'special', wave: 1, correct: 1 }));
    expect(engine.abilities.has(SPECIAL_ABILITY)).toBe(true);
    engine.finishArena();
    expect(engine.state.state).toBe(GameState.PLAYING);
    expect(engine.waves.waveNumber).toBe(1); // no wave skipped
  });

  test('a wrong special answer returns to combat without the ability', () => {
    const { engine } = waveWithOffer();
    step(engine, OFFER_AT + 0.5); // invitation visible (it lasts 4 s)
    engine.acceptSpecialOffer();
    engine.applyArenaRewards('s', calculateRewards({ kind: 'special', wave: 1, correct: 0 }));
    engine.finishArena();
    expect(engine.abilities.has('voidStorm')).toBe(false);
    expect(engine.state.state).toBe(GameState.PLAYING);
  });

  test('clicking after it expired does nothing', () => {
    const { engine } = engineInWave(1);
    expect(engine.acceptSpecialOffer()).toBe(false);
    expect(engine.state.state).toBe(GameState.PLAYING);
  });

  test('no spam: at most one per wave, never during the boss, never once VOID STORM is owned', () => {
    const { engine } = engineInWave(1, () => 0);
    engine.scheduleSpecialOffer();
    const offers = jest.fn();
    engine.bus.on('special:offer', offers);
    engine.player.maxHealth = engine.player.health = 1e9;
    step(engine, 60);
    expect(offers).toHaveBeenCalledTimes(1);

    engine.abilities.unlock('voidStorm');
    engine.scheduleSpecialOffer();
    step(engine, 20);
    expect(offers).toHaveBeenCalledTimes(1);

    const bossFight = engineInWave(1, () => 0).engine;
    bossFight.spawnBoss();
    bossFight.scheduleSpecialOffer();
    const bossOffers = jest.fn();
    bossFight.bus.on('special:offer', bossOffers);
    bossFight.player.maxHealth = bossFight.player.health = 1e9;
    step(bossFight, 20);
    expect(bossOffers).not.toHaveBeenCalled();
  });

  test('an open invitation is withdrawn when the wave ends (cannot replace the compulsory quiz)', () => {
    const { engine } = waveWithOffer();
    step(engine, OFFER_AT + 0.5); // invitation visible (it lasts 4 s)
    expect(engine.specialOffer).not.toBeNull();
    engine.onWaveComplete(1, false);
    expect(engine.specialOffer).toBeNull();
    expect(engine.arena.kind).toBe('wave');
    expect(engine.acceptSpecialOffer()).toBe(false);
  });
});

describe('AbilityManager', () => {
  let abilities;
  beforeEach(() => { abilities = new AbilityManager(new EventBus()); });

  test('energy is capped at 100', () => {
    abilities.addEnergy(80);
    expect(abilities.addEnergy(50)).toBe(20);
  });

  test('locked, cooldown and energy all block activation', () => {
    const engine = { player: { effects: {} } };
    expect(abilities.activate(1, engine)).toEqual({ ok: false, reason: 'locked' });
    abilities.unlock('plasmaShield');
    expect(abilities.activate(1, engine)).toEqual({ ok: false, reason: 'energy' });
    abilities.addEnergy(100);
    expect(abilities.activate(1, engine)).toEqual({ ok: true });
    expect(abilities.activate(1, engine)).toEqual({ ok: false, reason: 'cooldown' });
    abilities.update(ABILITIES.plasmaShield.cooldown);
    expect(abilities.activate(1, engine)).toEqual({ ok: true });
  });

  test('unlocking twice is ignored (no duplicate rewards)', () => {
    expect(abilities.unlock('tripleBeam')).toBe(true);
    expect(abilities.unlock('tripleBeam')).toBe(false);
  });

  test('every ability offered by the server exists, in the right key slot, with cost and cooldown', () => {
    for (const [wave, id] of Object.entries(WAVE_ABILITIES)) expect(ABILITIES[id].slot).toBe(Number(wave));
    expect(ABILITIES[SPECIAL_ABILITY].slot).toBe(5);
    for (const a of Object.values(ABILITIES)) {
      expect(a.cost).toBeGreaterThan(0);
      expect(a.cooldown).toBeGreaterThan(0);
    }
    expect(ABILITIES.voidStorm.cost).toBeGreaterThan(ABILITIES.empShockwave.cost);
  });
});

describe('Ability effects (each one is different)', () => {
  function armed(id) {
    const input = fakeInput();
    const engine = new GameEngine({ input });
    engine.startGame();
    engine.abilities.unlock(id);
    engine.abilities.addEnergy(100);
    return { engine, input, slot: ABILITIES[id].slot };
  }

  test('keys 1-5 activate abilities only during combat', () => {
    const { engine, input } = armed('plasmaShield');
    input.press('ability1');
    expect(engine.player.hasPlasmaShield).toBe(true);
    engine.openArena(1);
    expect(engine.activateAbility(1)).toEqual({ ok: false, reason: 'inactive' });
  });

  test('Plasma Shield: no damage taken and enemy bullets touching it are destroyed', () => {
    const { engine, slot } = armed('plasmaShield');
    engine.activateAbility(slot);
    engine.damagePlayer(500);
    expect(engine.player.health).toBe(100);
    const bullet = new Projectile({ x: engine.player.x + 40, y: engine.player.y, vx: 0, vy: 0, owner: 'enemy' });
    engine.projectiles.push(bullet);
    engine.update(0.001);
    expect(bullet.active).toBe(false);
  });

  test('Hyper Blaster: faster fire and double damage', () => {
    const { engine, slot } = armed('hyperBlaster');
    engine.activateAbility(slot);
    const [shot] = engine.player.fire();
    expect(shot.damage).toBe(2);
    expect(engine.player.cooldownTimer).toBeCloseTo(engine.player.fireCooldown * 0.4);
  });

  test('Triple Beam: three projectiles per shot', () => {
    const { engine, slot } = armed('tripleBeam');
    engine.activateAbility(slot);
    expect(engine.player.fire()).toHaveLength(3);
  });

  test('EMP Shockwave: clears bullets, damages every alien and stuns them', () => {
    const { engine, slot } = armed('empShockwave');
    const scout = engine.spawnEnemy('scout', 100, 100);
    const tank = engine.spawnEnemy('armored', 300, 100);
    engine.projectiles.push(new Projectile({ x: 50, y: 50, owner: 'enemy' }));
    engine.activateAbility(slot);
    expect(scout.alive).toBe(false);
    expect(tank.health).toBe(tank.maxHealth - 4);
    expect(engine.projectiles.some((p) => p.owner === 'enemy')).toBe(false);
    const y = tank.y;
    engine.update(1);
    expect(tank.y).toBe(y); // stunned
    expect(engine.stats.shotsHit).toBe(0); // ability hits do not inflate accuracy
  });

  test('VOID STORM: lightning strikes several aliens over 6 s', () => {
    const { engine, slot } = armed('voidStorm');
    const tanks = [100, 300, 500, 700].map((x) => engine.spawnEnemy('armored', x, 100));
    engine.stunTimer = 100; // keep them still for the test
    engine.activateAbility(slot);
    engine.update(0.01);
    expect(tanks.filter((t) => t.health < t.maxHealth)).toHaveLength(VOID_STORM.targetsPerStrike);
    for (let t = 0; t < 7; t += 0.05) engine.update(0.05);
    expect(engine.voidStorm).toBeNull();
    expect(tanks.every((t) => !t.alive)).toBe(true);
  });

  test('VOID STORM cannot instantly defeat the three-phase boss', () => {
    const { engine, slot } = armed('voidStorm');
    engine.spawnBoss();
    engine.boss.entering = false;
    engine.boss.y = engine.boss.entryY;
    engine.stunTimer = 100;
    const before = engine.boss.health;
    engine.activateAbility(slot);
    for (let t = 0; t < 7; t += 0.05) engine.update(0.05);
    const dealt = before - engine.boss.health;
    expect(dealt).toBeGreaterThan(0);
    expect(dealt).toBeLessThan(before * 0.2); // under 20% of its health
    expect(engine.boss.alive).toBe(true);
  });
});
