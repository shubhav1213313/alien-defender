import { ABILITIES, TIER_RANK, abilityStats } from './AbilityDefinitions.js';

export const MAX_ENERGY = 100;

// Holds Knowledge Energy, unlocked ability slots and cooldowns.
// Unlocked abilities stay available for the rest of the game; a slot is
// only ever upgraded (standard -> enhanced -> elite), never downgraded.
export class AbilityManager {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.energy = 0;
    this.maxEnergy = MAX_ENERGY;
    this.slots = new Map(); // slot number -> { id, tier }
    this.cooldowns = new Map(); // slot number -> seconds remaining
  }

  addEnergy(amount) {
    const before = this.energy;
    this.energy = Math.min(this.maxEnergy, this.energy + amount);
    this.bus.emit('energy:change', { energy: this.energy, gained: this.energy - before });
    return this.energy - before;
  }

  unlock(abilityId, tier) {
    const def = ABILITIES[abilityId];
    if (!def || !TIER_RANK[tier]) throw new Error(`Cannot unlock ${abilityId} (${tier})`);
    const current = this.slots.get(def.slot);
    if (current && TIER_RANK[current.tier] > TIER_RANK[tier]) return false;
    if (current && current.id === abilityId && current.tier === tier) return false;
    this.slots.set(def.slot, { id: abilityId, tier });
    this.bus.emit('ability:unlocked', { slot: def.slot, id: abilityId, tier, name: def.name });
    return true;
  }

  slotInfo(slot) {
    const entry = this.slots.get(slot);
    if (!entry) return null;
    const def = ABILITIES[entry.id];
    return { slot, ...entry, name: def.name, description: def.description, ...abilityStats(entry.id, entry.tier), cooldownLeft: this.cooldowns.get(slot) || 0 };
  }

  // Returns null if the ability can be used, otherwise the reason it cannot.
  blockedReason(slot) {
    const info = this.slotInfo(slot);
    if (!info) return 'locked';
    if (info.cooldownLeft > 0) return 'cooldown';
    if (this.energy < info.cost) return 'energy';
    return null;
  }

  activate(slot, engine) {
    const reason = this.blockedReason(slot);
    if (reason) {
      this.bus.emit('ability:blocked', { slot, reason });
      return { ok: false, reason };
    }
    const info = this.slotInfo(slot);
    this.energy -= info.cost;
    this.cooldowns.set(slot, info.cooldown);
    ABILITIES[info.id].apply(engine, info);
    this.bus.emit('ability:activated', { slot, id: info.id, tier: info.tier, name: info.name, energy: this.energy });
    return { ok: true };
  }

  update(dt) {
    for (const [slot, left] of this.cooldowns) this.cooldowns.set(slot, Math.max(0, left - dt));
  }
}
