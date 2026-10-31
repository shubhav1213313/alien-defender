/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import { QuoteView, ApiStatusIndicator } from '../../public/js/ui/InfoWidgets.js';
import { EventBus } from '../../public/js/game/EventBus.js';

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
});

describe('QuoteView', () => {
  test('ZenQuotes quotes show the required attribution link', async () => {
    const api = jest.fn(async () => ({ quote: 'Stay curious.', author: 'Someone', source: 'zenquotes',
      attribution: { text: 'Inspirational quotes provided by ZenQuotes API', url: 'https://zenquotes.io/' } }));
    const view = new QuoteView({ bus: new EventBus(), api });
    await view.load('menu');
    const slot = document.querySelector('[data-quote="menu"]');
    expect(slot.querySelector('blockquote').textContent).toBe('“Stay curious.”');
    const link = slot.querySelector('a');
    expect(link.href).toBe('https://zenquotes.io/');
    expect(link.rel).toBe('noopener noreferrer');
  });

  test('fallback quotes are labelled offline, with no link', async () => {
    const api = jest.fn(async () => ({ quote: 'Regroup.', author: 'Alien Defender', source: 'fallback', attribution: null }));
    const view = new QuoteView({ bus: new EventBus(), api });
    await view.load('gameover');
    const slot = document.querySelector('[data-quote="gameover"]');
    expect(slot.textContent).toContain('offline quote');
    expect(slot.querySelector('a')).toBeNull();
  });

  test('loads automatically when the game-over screen appears, never during play', async () => {
    const bus = new EventBus();
    const api = jest.fn(async () => ({ quote: 'Q', author: 'A', source: 'fallback' }));
    new QuoteView({ bus, api });
    bus.emit('state:change', { from: 'menu', to: 'playing' });
    bus.emit('state:change', { from: 'playing', to: 'paused' });
    expect(api).not.toHaveBeenCalled();
    bus.emit('state:change', { from: 'playing', to: 'gameOver' });
    await flush();
    expect(api).toHaveBeenCalledWith('/api/quotes/random?context=gameover', expect.anything());
  });

  test('quote text is inserted as text, not HTML', async () => {
    const api = jest.fn(async () => ({ quote: '<img src=x onerror=alert(1)>', author: '<b>x</b>', source: 'fallback' }));
    const view = new QuoteView({ bus: new EventBus(), api });
    await view.load('menu');
    expect(document.querySelector('[data-quote="menu"] img')).toBeNull();
  });

  test('a failed request just leaves the quote empty', async () => {
    const view = new QuoteView({ bus: new EventBus(), api: jest.fn(async () => { throw new Error('offline'); }) });
    await view.load('menu');
    expect(document.querySelector('[data-quote="menu"]').textContent).toBe('');
  });
});

describe('ApiStatusIndicator', () => {
  test('shows measured latency, or the error for a failing API', async () => {
    const element = document.getElementById('api-status');
    const api = jest.fn(async () => ({
      banana: { source: 'banana', latencyMs: 312, error: null },
      quotes: { source: 'zenquotes', latencyMs: 845, error: 'RATE_LIMITED' },
    }));
    await new ApiStatusIndicator({ bus: new EventBus(), element, api }).refresh();
    expect(element.textContent).toBe('Banana: 312 ms · ZenQuotes: offline (RATE_LIMITED)');
    expect(element.classList.contains('degraded')).toBe(true);
  });

  test('APIs not used yet are reported honestly', () => {
    expect(ApiStatusIndicator.describe('Banana', { source: null })).toBe('Banana: not used yet');
  });
});
