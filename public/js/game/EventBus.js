// Observer pattern: a tiny publish/subscribe event bus.
// Game systems announce what happened (e.g. 'enemy:destroyed') without
// knowing who is listening - the HUD, audio, achievements and score system
// each subscribe independently. This keeps modules loosely coupled.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  // Returns an unsubscribe function for convenience.
  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(event, handler) {
    const set = this.handlers.get(event);
    if (set) set.delete(handler);
  }

  emit(event, payload) {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy first so handlers can unsubscribe while the event is being delivered.
    for (const handler of [...set]) handler(payload);
  }

  clear() {
    this.handlers.clear();
  }
}
