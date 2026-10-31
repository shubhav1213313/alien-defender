/**
 * @jest-environment jsdom
 */
// UI tests for the Knowledge Arena screen, run in a simulated browser DOM.
// The server API is MOCKED with the real ChallengeService behind it, so
// answers, duplicate protection and rewards behave exactly as on the server.
import { KnowledgeArena, describeReward } from '../../public/js/ui/KnowledgeArena.js';
import { EventBus } from '../../public/js/game/EventBus.js';
const { ChallengeService } = require('../../src/services/challengeService');
const { describeArena } = require('../../src/services/arenaRules');

const SOLUTIONS = [4, 6, 1, 8];

// Mock api(path, options) that routes to a real ChallengeService.
function mockApi({ failQuestion = false } = {}) {
  let i = 0;
  const service = new ChallengeService({
    puzzleProvider: { getPuzzle: async () => ({ image: 'data:image/png;base64,AAAA', solution: SOLUTIONS[i++ % 4], source: 'banana', latencyMs: 300 }) },
  });
  const calls = [];
  const api = jest.fn(async (path, { method = 'GET', body } = {}) => {
    calls.push(`${method} ${path}`);
    const url = new URL(path, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean); // api, challenges, id, action
    if (parts[2] === 'rules') return describeArena(Number(url.searchParams.get('wave')));
    if (parts.length === 2) return service.createArena(body);
    const [, , id, action] = parts;
    if (action === 'question') {
      if (failQuestion) throw Object.assign(new Error('Cannot reach the game server.'), { status: 0 });
      return service.getQuestion(id);
    }
    if (action === 'answer') return service.submitAnswer(id, body);
    if (action === 'claim') return service.claimRewards(id);
    if (action === 'hint') return service.useHint(id);
    throw new Error(`unexpected ${path}`);
  });
  return { api, calls };
}

function setup(options) {
  document.body.innerHTML = `
    <section id="screen-arena">
      <h2 data-arena="title"></h2><p data-arena="subtitle"></p><div data-arena="body"></div>
    </section>`;
  const bus = new EventBus();
  const engine = { bus, applyArenaRewards: jest.fn(() => true), finishArena: jest.fn(() => true) };
  const { api, calls } = mockApi(options);
  const arena = new KnowledgeArena({ engine, root: document.getElementById('screen-arena'), api });
  return { bus, engine, api, calls, arena, body: () => document.querySelector('[data-arena="body"]') };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const click = async (text) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (!button) throw new Error(`No button "${text}" in: ${document.body.textContent}`);
  button.click();
  await flush();
};
async function answer(value) {
  document.querySelector('.arena-answer').value = String(value);
  document.querySelector('.arena-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
}

afterEach(() => jest.useRealTimers());

describe('Knowledge Arena UI', () => {
  test('opens automatically on arena:open and shows difficulty choices, rules and abilities', async () => {
    const { bus, body } = setup();
    bus.emit('arena:open', { wave: 2, postBoss: false, nextWave: 3 });
    await flush();
    expect(document.querySelector('[data-arena="subtitle"]').textContent).toContain('Wave 2 cleared');
    const labels = [...body().querySelectorAll('.arena-card strong')].map((n) => n.textContent);
    expect(labels).toEqual(['Easy', 'Normal', 'Hard']);
    expect(body().textContent).toContain('Rapid Fire');
    expect(body().textContent).toContain('Phantom Overdrive');
    expect(body().textContent).toContain('no difficulty setting');
  });

  test('plays four questions in order with feedback, then shows score and rewards', async () => {
    const { bus, engine, body } = setup();
    bus.emit('arena:open', { wave: 1, postBoss: false, nextWave: 2 });
    await flush();
    document.querySelector('input[value="hard"]').checked = true;
    await click('Begin Challenge');

    const answers = [4, 6, 1, 0]; // last one wrong -> 3/4
    for (let i = 0; i < 4; i += 1) {
      expect(body().textContent).toContain(`QUESTION ${i + 1}/4`);
      expect(body().textContent).toContain('Live Banana API · 300 ms');
      await answer(answers[i]);
      if (i < 3) {
        expect(body().querySelector('.feedback.correct')).not.toBeNull();
        await click('Next question');
      }
    }
    expect(body().querySelector('.feedback.wrong').textContent).toContain('Incorrect');
    expect(body().textContent).toContain('The correct answer was 8.');
    await click('See results');

    expect(body().querySelector('.arena-score').textContent).toBe('3 / 4');
    expect(engine.applyArenaRewards).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ correct: 3, ability: { id: 'miniShield', tier: 'standard', slot: 1 } }));
    expect(body().querySelector('.rewards.earned').textContent).toContain('Mini Shield');
    expect(body().querySelector('.rewards.missed').textContent).toContain('Ghost Mode'); // what 4/4 Hard would have given
    await click('Continue to Wave 2');
    expect(engine.finishArena).toHaveBeenCalledTimes(1);
  });

  test('double submissions send only one answer to the server', async () => {
    const { bus, calls } = setup();
    bus.emit('arena:open', { wave: 1, postBoss: false, nextWave: 2 });
    await flush();
    await click('Begin Challenge');
    document.querySelector('.arena-answer').value = '4';
    const form = document.querySelector('.arena-form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.filter((c) => c.includes('/answer'))).toHaveLength(1);
  });

  test('when the timer runs out the question is submitted as incorrect', async () => {
    jest.useFakeTimers();
    const { bus, body, calls } = setup();
    bus.emit('arena:open', { wave: 1, postBoss: false, nextWave: 2 });
    await jest.runOnlyPendingTimersAsync();
    document.querySelector('input[value="hard"]').checked = true;
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Begin')).click();
    await jest.advanceTimersByTimeAsync(10);
    expect(body().textContent).toContain('QUESTION 1/4');
    await jest.advanceTimersByTimeAsync(21000);
    expect(calls.filter((c) => c.includes('/answer'))).toHaveLength(1);
    expect(body().textContent).toContain('Time ran out');
  });

  test('a 0/4 arena still offers the way forward', async () => {
    const { bus, engine, body } = setup();
    bus.emit('arena:open', { wave: 3, postBoss: false, nextWave: 4 });
    await flush();
    await click('Begin Challenge');
    for (let i = 0; i < 4; i += 1) {
      await answer(9);
      await click(i < 3 ? 'Next question' : 'See results');
    }
    expect(body().querySelector('.arena-score').textContent).toBe('0 / 4');
    expect(body().textContent).toContain('you continue to the next stage');
    await click('Continue to Wave 4');
    expect(engine.finishArena).toHaveBeenCalled();
  });

  test('server errors show Retry and a way out, never a dead end', async () => {
    const { bus, engine, body } = setup({ failQuestion: true });
    bus.emit('arena:open', { wave: 1, postBoss: false, nextWave: 2 });
    await flush();
    await click('Begin Challenge');
    expect(body().textContent).toContain('Cannot reach the game server');
    await click('Try again');
    expect(body().textContent).toContain('Cannot reach the game server');
    await click('Continue without rewards');
    expect(engine.finishArena).toHaveBeenCalled();
    expect(engine.applyArenaRewards).not.toHaveBeenCalled();
  });

  test('post-boss arena is presented as a victory bonus', async () => {
    const { bus } = setup();
    bus.emit('arena:open', { wave: 5, postBoss: true, nextWave: null });
    await flush();
    expect(document.querySelector('[data-arena="title"]').textContent).toBe('Victory Bonus Challenge');
    expect(document.body.textContent).toContain('Legendary Defender');
  });

  test('describeReward lists every reward type', () => {
    expect(describeReward({ energy: 40, repair: 25, ability: { id: 'ultimateNova', tier: 'elite' }, scoreBonus: 4000, achievements: ['legendary_defender'] }))
      .toEqual(['+40 Knowledge Energy', '+25 hull repair', 'Unlock Ultimate Nova (ELITE) - key 4', '+4,000 bonus points', 'Achievement: Legendary Defender']);
    expect(describeReward({ energy: 0 })).toEqual(['No reward']);
  });
});
