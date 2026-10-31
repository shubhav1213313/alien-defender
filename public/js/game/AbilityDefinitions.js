// Special abilities unlocked by solving Banana puzzles.
//   keys 1-4: solve BOTH puzzles of the compulsory quiz after waves 1-4
//   key  5  : VOID STORM - solve the optional special puzzle during combat
// Each ability has a different real effect, an energy cost (Knowledge
// Energy, earned by correct answers), a cooldown and - for timed effects - a
// duration shown on the HUD. apply(engine) performs the effect.
export const ABILITIES = Object.freeze({
  plasmaShield: {
    id: 'plasmaShield', slot: 1, name: 'Plasma Shield', short: 'SHLD', color: '#50aaff',
    cost: 20, cooldown: 18, duration: 6,
    description: 'A plasma barrier for 6 s: you take no damage and enemy bullets touching it are destroyed.',
    apply(engine) {
      engine.player.effects.plasmaShield = this.duration;
    },
  },
  hyperBlaster: {
    id: 'hyperBlaster', slot: 2, name: 'Hyper Blaster', short: 'HYPR', color: '#ff9f1c',
    cost: 25, cooldown: 16, duration: 8,
    description: 'For 8 s you fire 2.5x faster and every shot does double damage.',
    apply(engine) {
      engine.player.effects.hyperBlaster = this.duration;
    },
  },
  tripleBeam: {
    id: 'tripleBeam', slot: 3, name: 'Triple Beam', short: 'TRPL', color: '#c77dff',
    cost: 25, cooldown: 16, duration: 10,
    description: 'For 10 s every shot splits into three beams.',
    apply(engine) {
      engine.player.effects.tripleBeam = this.duration;
    },
  },
  empShockwave: {
    id: 'empShockwave', slot: 4, name: 'EMP Shockwave', short: 'EMP', color: '#7bdff2',
    cost: 35, cooldown: 22, duration: 0,
    description: 'Destroys all enemy bullets, deals 4 damage to every alien (15 to the boss) and stuns aliens for 2 s.',
    apply(engine) {
      engine.empShockwave({ damage: 4, bossDamage: 15, stunSeconds: 2 });
    },
  },
  voidStorm: {
    id: 'voidStorm', slot: 5, name: 'VOID STORM', short: 'VOID', color: '#f72585',
    cost: 50, cooldown: 40, duration: 6,
    description: 'Legendary: for 6 s lightning strikes up to 3 aliens every 0.4 s (3 damage each; 2 to the boss).',
    apply(engine) {
      engine.startVoidStorm(this.duration);
    },
  },
});

export const ABILITY_IDS = Object.keys(ABILITIES);
