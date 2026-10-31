import { ABILITIES } from './AbilityDefinitions.js';

export const MAX_ENERGY = 100;

// Holds Knowledge Energy, unlocked ability slots and cooldowns.
// An unlocked ability stays available for the rest of the game.
export class AbilityManager {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.energy = 0;
    this.maxEnergy = MAX_ENERGY;
    this.slots = new Map(); // slot number -> ability id
    this.cooldowns = new Map(); // slot number -> seconds remaining
  }

  addEnergy(amount) {
    const before = this.energy;
    this.energy = Math.min(this.maxEnergy, this.energy + amount);
    this.bus.emit('energy:change', { energy: this.energy, gained: this.energy - before });
    return this.energy - before;
  }

  has(abilityId) {
    const def = ABILITIES[abilityId];
    return Boolean(def) && this.slots.get(def.slot) === abilityId;
  }

  // Returns false if it was already unlocked (no duplicate unlock events).
  unlock(abilityId) {
    const def = ABILITIES[abilityId];
    if (!def) throw new Error(`Unknown ability: ${abilityId}`);
    if (this.has(abilityId)) return false;
    this.slots.set(def.slot, abilityId);
    this.bus.emit('ability:unlocked', { slot: def.slot, id: abilityId, name: def.name });
    return true;
  }

  slotInfo(slot) {
    const id = this.slots.get(slot);
    if (!id) return null;
    const def = ABILITIES[id];
    return { slot, id, name: def.name, short: def.short, color: def.color, description: def.description,
      cost: def.cost, cooldown: def.cooldown, duration: def.duration, cooldownLeft: this.cooldowns.get(slot) || 0 };
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
    ABILITIES[info.id].apply(engine);
    this.bus.emit('ability:activated', { slot, id: info.id, name: info.name, energy: this.energy });
    return { ok: true };
  }

  update(dt) {
    for (const [slot, left] of this.cooldowns) this.cooldowns.set(slot, Math.max(0, left - dt));
  }
}
