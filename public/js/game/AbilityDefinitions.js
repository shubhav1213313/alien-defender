// Special abilities unlocked in the Knowledge Challenge Arena.
// Each wave's arena offers one ability slot (activated with keys 1-4):
//   standard - unlocked with 3/4 (or 4/4 on Easy)
//   enhanced - the standard ability with +50% duration/power and -25% cost (4/4 on Normal)
//   elite    - a stronger version (4/4 on Hard)
// apply(engine, stats) performs the effect; stats holds the tier-adjusted
// duration and power so one definition serves both standard and enhanced.
export const TIER_RANK = { standard: 1, enhanced: 2, elite: 3 };

export const ABILITIES = Object.freeze({
  miniShield: {
    id: 'miniShield', slot: 1, name: 'Mini Shield', cost: 20, cooldown: 12, duration: 0,
    description: 'Instantly restores 25 shield.',
    apply(engine, { power }) {
      engine.player.addShield(25 * power);
    },
  },
  ghostMode: {
    id: 'ghostMode', slot: 1, name: 'Ghost Mode', cost: 30, cooldown: 20, duration: 5,
    description: 'Phase out of reality: immune to all damage for 5s.',
    apply(engine, { duration }) {
      engine.player.effects.ghost = Math.max(engine.player.effects.ghost, duration);
    },
  },
  rapidFire: {
    id: 'rapidFire', slot: 2, name: 'Rapid Fire', cost: 25, cooldown: 15, duration: 6,
    description: 'Fire 2.5x faster for 6s.',
    apply(engine, { duration }) {
      engine.player.effects.rapidFire = Math.max(engine.player.effects.rapidFire, duration);
    },
  },
  phantomOverdrive: {
    id: 'phantomOverdrive', slot: 2, name: 'Phantom Overdrive', cost: 40, cooldown: 25, duration: 6,
    description: 'Invisible (aliens cannot aim at you), invulnerable and rapid fire for 6s.',
    apply(engine, { duration }) {
      const fx = engine.player.effects;
      fx.ghost = Math.max(fx.ghost, duration);
      fx.invisible = Math.max(fx.invisible, duration);
      fx.rapidFire = Math.max(fx.rapidFire, duration);
    },
  },
  tripleLaser: {
    id: 'tripleLaser', slot: 3, name: 'Triple Laser', cost: 25, cooldown: 15, duration: 8,
    description: 'Every shot splits into three for 8s.',
    apply(engine, { duration }) {
      engine.player.effects.tripleShot = Math.max(engine.player.effects.tripleShot, duration);
    },
  },
  timeFreezeLaser: {
    id: 'timeFreezeLaser', slot: 3, name: 'Time Freeze + Triple Laser', cost: 40, cooldown: 30, duration: 8,
    description: 'Freezes every alien and alien bullet for 4s, plus Triple Laser for 8s.',
    apply(engine, { duration }) {
      engine.timeFreeze = Math.max(engine.timeFreeze, 4);
      engine.player.effects.tripleShot = Math.max(engine.player.effects.tripleShot, duration);
    },
  },
  empBlast: {
    id: 'empBlast', slot: 4, name: 'EMP Blast', cost: 35, cooldown: 20, duration: 0,
    description: 'Destroys all alien bullets and deals 3 damage to every alien on screen.',
    apply(engine, { power }) {
      engine.shockwave({ damage: Math.round(3 * power), bossDamage: Math.round(12 * power), color: '#7bdff2' });
    },
  },
  ultimateNova: {
    id: 'ultimateNova', slot: 4, name: 'Ultimate Nova', cost: 50, cooldown: 35, duration: 2,
    description: 'Massive blast: clears bullets, 10 damage to every alien, heavy boss damage, 2s invulnerability.',
    apply(engine, { duration }) {
      engine.shockwave({ damage: 10, bossDamage: 40, color: '#ffd166' });
      engine.player.effects.ghost = Math.max(engine.player.effects.ghost, duration);
    },
  },
});

// Tier-adjusted numbers for display and activation.
export function abilityStats(abilityId, tier) {
  const def = ABILITIES[abilityId];
  if (!def) throw new Error(`Unknown ability: ${abilityId}`);
  const enhanced = tier === 'enhanced';
  return {
    cost: enhanced ? Math.round(def.cost * 0.75) : def.cost,
    cooldown: def.cooldown,
    duration: enhanced ? def.duration * 1.5 : def.duration,
    power: enhanced ? 1.5 : 1,
  };
}
