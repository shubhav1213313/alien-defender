/**
 * @jest-environment jsdom
 */
// UI tests for the Knowledge Challenge screen and the special-puzzle
// invitation, in a simulated browser using the REAL public/index.html.
// The server API is mocked with the real ChallengeService behind it.
import fs from 'fs';
import path from 'path';
import { KnowledgeArena, describeReward } from '../../public/js/ui/KnowledgeArena.js';
import { SpecialOffer } from '../../public/js/ui/SpecialOffer.js';
import { EventBus } from '../../public/js/game/EventBus.js';
const { ChallengeService } = require('../../src/services/challengeService');
const { PuzzleUnavailableError } = require('../../src/services/puzzleService');
const { describeChallenge } = require('../../src/services/arenaRules');

const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const SOLUTIONS = [4, 6, 1];
const flush = () => new Promise((r) => setTimeout(r, 0));

function mockApi({ apiDown = false } = {}) {
  let i = 0;
  const state = { apiDown };
  const service = new ChallengeService({
    puzzleProvider: { getPuzzle: async () => {
      if (state.apiDown) throw new PuzzleUnavailableError({ code: 'TIMEOUT' });
      return { image: 'data:image/png;base64,iVBORw0KGgo', solution: SOLUTIONS[i++ % 3], source: 'banana', latencyMs: 300 };
    } },
  });
  const calls = [];
  const api = jest.fn(async (p, { method = 'GET', body } = {}) => {
    calls.push(`${method} ${p}`);
    const url = new URL(p, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[2] === 'rules') return describeChallenge(url.searchParams.get('kind'), Number(url.searchParams.get('wave')));
    if (parts.length === 2) return service.createArena(body);
    const [, , id, action] = parts;
    if (action === 'question') return service.getQuestion(id);
    if (action === 'answer') return service.submitAnswer(id, body);
    if (action === 'claim') return service.claimRewards(id);
    if (action === 'hint') return service.useHint(id);
    throw new Error(`unexpected ${p}`);
  });
  return { api, calls, state };
}

function setup(options) {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const bus = new EventBus();
  const engine = { bus, applyArenaRewards: jest.fn(() => true), finishArena: jest.fn(() => true), specialOffer: null, acceptSpecialOffer: jest.fn() };
  const { api, calls, state } = mockApi(options);
  const root = document.getElementById('screen-arena');
  root.hidden = false;
  new KnowledgeArena({ engine, root, api });
  return { bus, engine, calls, state, body: () => document.querySelector('[data-arena="body"]') };
}

const click = async (text) => {
  const button = [...document.querySelectorAll('#screen-arena button')].find((b) => b.textContent.includes(text));
  if (!button) throw new Error(`No button "${text}" in: ${document.querySelector('#screen-arena').textContent}`);
  button.click();
  await flush();
};
const pressDigit = async (d) => { document.querySelector(`[data-digit="${d}"]`).click(); await flush(); };

test('the page contains NO Upgrade Bay, upgrade overlay or Q-key terminal', () => {
  expect(html).not.toMatch(/upgrade/i);
  expect(html).not.toMatch(/Knowledge Terminal/i);
  expect(html).not.toMatch(/\(Q\)/);
});

describe('Compulsory 2-puzzle quiz', () => {
  test('intro shows instructions and "SOLVE BOTH PUZZLES TO UNLOCK PLASMA SHIELD"', async () => {
    const { bus, body } = setup();
    bus.emit('arena:open', { kind: 'wave', wave: 1, nextWave: 2 });
    await flush();
    expect(document.querySelector('[data-arena="title"]').textContent).toBe('Knowledge Challenge');
    expect(body().querySelector('.reward-preview').textContent).toBe('SOLVE BOTH PUZZLES TO UNLOCK PLASMA SHIELD');
    expect(body().querySelector('.arena-instructions').textContent).toMatch(/0-9 buttons/);
    expect(body().textContent).toMatch(/next wave starts afterwards/);
  });

  test('two puzzles with 0-9 buttons; 2/2 unlocks the ability; continue starts the next wave', async () => {
    const { bus, engine, body } = setup();
    bus.emit('arena:open', { kind: 'wave', wave: 1, nextWave: 2 });
    await flush();
    await click('Start the quiz');
    expect(body().textContent).toContain('PUZZLE 1 OF 2');
    expect(body().querySelectorAll('.digit')).toHaveLength(10);
    expect(body().querySelector('.arena-puzzle').src).toBe('data:image/png;base64,iVBORw0KGgo'); // image untouched
    await pressDigit(4);
    expect(body().querySelector('.feedback.correct')).not.toBeNull();
    await click('Next puzzle');
    expect(body().textContent).toContain('PUZZLE 2 OF 2');
    await pressDigit(6);
    await click('See the result');
    expect(body().querySelector('.arena-score').textContent).toBe('2 / 2');
    expect(body().querySelector('.unlock').textContent).toBe('⚡ Plasma Shield UNLOCKED!');
    expect(engine.applyArenaRewards).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ability: expect.objectContaining({ id: 'plasmaShield' }) }));
    await click('Start Wave 2');
    expect(engine.finishArena).toHaveBeenCalledTimes(1);
  });

  test('1/2 shows the answer, unlocks nothing and still offers the next wave', async () => {
    const { bus, body, engine } = setup();
    bus.emit('arena:open', { kind: 'wave', wave: 3, nextWave: 4 });
    await flush();
    await click('Start the quiz');
    await pressDigit(4);
    await click('Next puzzle');
    await pressDigit(0);
    expect(body().textContent).toContain('The answer was 6.');
    await click('See the result');
    expect(body().querySelector('.arena-score').textContent).toBe('1 / 2');
    expect(body().textContent).toContain('Triple Beam stays locked');
    expect(body().textContent).toContain('next wave starts as normal');
    await click('Start Wave 4');
    expect(engine.finishArena).toHaveBeenCalled();
  });

  test('number keys 0-9 also answer', async () => {
    const { bus, body } = setup();
    bus.emit('arena:open', { kind: 'wave', wave: 1, nextWave: 2 });
    await flush();
    await click('Start the quiz');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    await flush();
    expect(body().querySelector('.feedback.correct')).not.toBeNull();
  });

  test('a valid answer is never rejected as "already answered"; double clicks send one answer', async () => {
    const { bus, calls, body } = setup();
    bus.emit('arena:open', { kind: 'wave', wave: 1, nextWave: 2 });
    await flush();
    await click('Start the quiz');
    const four = document.querySelector('[data-digit="4"]');
    four.click();
    four.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    await flush();
    expect(calls.filter((c) => c.includes('/answer'))).toHaveLength(1);
    expect(body().textContent).not.toMatch(/already been answered|expired/);
    expect(body().querySelector('.feedback.correct')).not.toBeNull();
  });

  test('hint button gives an honest hint without the answer', async () => {
    const { bus } = setup();
    bus.emit('arena:open', { kind: 'wave', wave: 1, nextWave: 2 });
    await flush();
    await click('Start the quiz');
    await click('Show a hint');
    const hint = document.querySelector('.arena-hint').textContent;
    expect(hint).toBe('Hint: The answer is an even number between 0 and 4.');
    expect(hint).not.toMatch(/answer is 4/); // narrows it down, never gives it away
  });

  test('Banana API down: Retry or Continue without ability - never stuck, nothing fabricated', async () => {
    const { bus, body, engine, state } = setup({ apiDown: true });
    bus.emit('arena:open', { kind: 'wave', wave: 2, nextWave: 3 });
    await flush();
    await click('Start the quiz');
    expect(body().textContent).toMatch(/Banana puzzle service is unavailable/);
    expect(body().querySelector('.arena-puzzle')).toBeNull(); // no fake puzzle shown
    state.apiDown = false;
    await click('Retry');
    expect(body().textContent).toContain('PUZZLE 1 OF 2');
    state.apiDown = true;
    await pressDigit(4);
    await click('Next puzzle');
    await click('Continue without ability');
    expect(engine.finishArena).toHaveBeenCalled();
  });
});

describe('Special puzzle', () => {
  test('one puzzle, no hint; correct unlocks VOID STORM; back to the battle', async () => {
    const { bus, engine, body } = setup();
    bus.emit('arena:open', { kind: 'special', wave: 2 });
    await flush();
    expect(document.querySelector('[data-arena="title"]').textContent).toBe('⚡ Special Puzzle');
    expect(body().querySelector('.reward-preview').textContent).toBe('SOLVE THIS PUZZLE TO UNLOCK VOID STORM');
    await click('Show the puzzle');
    expect(body().textContent).toContain('PUZZLE 1 OF 1');
    expect([...body().querySelectorAll('button')].some((b) => b.textContent.includes('hint'))).toBe(false);
    await pressDigit(4);
    await click('See the result');
    expect(body().querySelector('.unlock').textContent).toBe('⚡ VOID STORM UNLOCKED!');
    await click('Back to the battle');
    expect(engine.finishArena).toHaveBeenCalled();
  });

  test('the invitation shows a 4-second countdown and a click accepts it', () => {
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const bus = new EventBus();
    const engine = { bus, specialOffer: { remaining: 3.2 }, acceptSpecialOffer: jest.fn() };
    const element = document.getElementById('special-offer');
    new SpecialOffer({ engine, element });
    expect(element.hidden).toBe(true);
    bus.emit('special:offer', { seconds: 4 });
    expect(element.hidden).toBe(false);
    expect(element.textContent).toContain('⚡ SPECIAL PUZZLE AVAILABLE!');
    expect(element.textContent).toContain('Solve one hard puzzle to unlock VOID STORM!');
    expect(element.querySelector('[data-offer-countdown]').textContent).toBe('4s');
    element.click();
    expect(engine.acceptSpecialOffer).toHaveBeenCalled();
    bus.emit('special:expired', {});
    expect(element.hidden).toBe(true);
  });
});

test('describeReward lists ability, energy, points and achievements', () => {
  expect(describeReward({ ability: { id: 'voidStorm' }, energy: 30, scoreBonus: 4000, achievements: ['legendary_defender'] }))
    .toEqual(['Unlocked VOID STORM - press 5 in combat', '+30 Knowledge Energy', '+4,000 bonus points', 'Achievement: Legendary Defender']);
  expect(describeReward({ energy: 0 })).toEqual(['No reward this time']);
});
