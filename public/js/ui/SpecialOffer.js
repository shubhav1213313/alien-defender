// The small right-side "⚡ SPECIAL PUZZLE AVAILABLE!" invitation.
// The ENGINE decides when it appears and expires (4 s of combat time, so a
// pause freezes the countdown too); this class only shows it, counts down
// and forwards a click to engine.acceptSpecialOffer().
export class SpecialOffer {
  constructor({ engine, element }) {
    this.engine = engine;
    this.element = element;
    this.countdown = element.querySelector('[data-offer-countdown]');
    this.frame = null;
    element.addEventListener('click', () => {
      element.blur(); // so pressing Space (fire) later cannot "click" it again
      this.engine.acceptSpecialOffer();
    });
    const { bus } = engine;
    bus.on('special:offer', () => this.show());
    bus.on('special:expired', () => this.hide());
    bus.on('special:accepted', () => this.hide());
    bus.on('state:change', ({ to }) => { if (to !== 'playing' && to !== 'paused') this.hide(); });
  }

  show() {
    this.element.hidden = false;
    this.element.disabled = false;
    const tick = () => {
      const offer = this.engine.specialOffer;
      if (!offer) return this.hide();
      this.countdown.textContent = `${Math.ceil(offer.remaining)}s`;
      this.element.style.setProperty('--progress', String(offer.remaining / 4));
      this.frame = requestAnimationFrame(tick);
      return undefined;
    };
    tick();
  }

  hide() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.element.hidden = true;
    this.element.disabled = true;
  }
}
