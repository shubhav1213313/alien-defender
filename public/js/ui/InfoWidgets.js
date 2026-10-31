import { apiRequest } from '../api/apiClient.js';
import { el } from './dom.js';

// Shows a motivational quote (ZenQuotes via our server) on the menu,
// game-over and victory screens. Loaded only when one of those screens
// appears - never during gameplay - and the game never waits for it.
export class QuoteView {
  constructor({ bus, api = apiRequest, root = document }) {
    this.api = api;
    this.slots = Object.fromEntries([...root.querySelectorAll('[data-quote]')].map((n) => [n.dataset.quote, n]));
    const contextFor = { menu: 'menu', gameOver: 'gameover', victory: 'victory' };
    bus.on('state:change', ({ to }) => {
      if (contextFor[to]) this.load(contextFor[to]);
    });
  }

  async load(context) {
    const slot = this.slots[context];
    if (!slot) return;
    slot.replaceChildren(el('p', { class: 'quote-loading' }, '…'));
    try {
      this.render(slot, await this.api(`/api/quotes/random?context=${context}`, { timeoutMs: 5000 }));
    } catch {
      slot.replaceChildren(); // a missing quote is not worth an error message
    }
  }

  render(slot, q) {
    // Attribution link is required by the ZenQuotes free-tier terms.
    const credit = q.source === 'zenquotes'
      ? el('a', { href: q.attribution.url, target: '_blank', rel: 'noopener noreferrer' }, 'Quotes by ZenQuotes')
      : el('span', { class: 'offline' }, 'offline quote');
    slot.replaceChildren(
      el('blockquote', {}, `“${q.quote}”`),
      el('figcaption', {}, `— ${q.author} · `, credit),
    );
  }
}

// Small indicator showing the last measured status and latency of both
// external APIs (interoperability made visible).
export class ApiStatusIndicator {
  constructor({ bus, element, api = apiRequest }) {
    this.element = element;
    this.api = api;
    bus.on('state:change', ({ to }) => {
      if (['menu', 'gameOver', 'victory', 'waveTransition'].includes(to)) this.refresh();
    });
    bus.on('arena:rewards', () => this.refresh());
  }

  static describe(name, status) {
    if (!status || !status.source) return `${name}: not used yet`;
    if (status.error) return `${name}: offline (${status.error})`;
    return `${name}: ${status.latencyMs} ms`;
  }

  async refresh() {
    try {
      const { banana, quotes } = await this.api('/api/status');
      this.element.textContent = `${ApiStatusIndicator.describe('Banana', banana)} · ${ApiStatusIndicator.describe('ZenQuotes', quotes)}`;
      this.element.classList.toggle('degraded', Boolean(banana.error || quotes.error));
    } catch {
      this.element.textContent = 'APIs: status unavailable';
    }
  }
}
