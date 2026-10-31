// /api/quotes/random and /api/status with ZenQuotes MOCKED.
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');
const { QuoteService } = require('../../src/services/quoteService');
const { PuzzleService } = require('../../src/services/puzzleService');

describe('GET /api/quotes/random', () => {
  test('returns a ZenQuotes quote with attribution when the API works', async () => {
    const quoteService = new QuoteService({ fetchQuotes: async () => ({ quotes: [{ quote: 'Stay curious.', author: 'Someone' }], latencyMs: 90 }) });
    const { app } = createTestApp({ quoteService });
    const res = await request(app).get('/api/quotes/random?context=victory');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ quote: 'Stay curious.', author: 'Someone', source: 'zenquotes', context: 'victory',
      attribution: { text: 'Inspirational quotes provided by ZenQuotes API', url: 'https://zenquotes.io/' } });
  });

  test('falls back to built-in quotes when ZenQuotes is unavailable (still 200)', async () => {
    const { app } = createTestApp(); // test helper's ZenQuotes always fails
    const res = await request(app).get('/api/quotes/random?context=gameover');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ source: 'fallback', author: 'Alien Defender' });
  });

  test('a slow ZenQuotes does not delay the response beyond its timeout', async () => {
    const quoteService = new QuoteService({
      timeoutMs: 100,
      logger: { warn() {} },
      // Uses the real timeout logic with a fetch that never answers.
      fetchQuotes: (opts) => require('../../src/services/quoteService').fetchZenQuotes({
        ...opts,
        fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))),
      }),
    });
    const { app } = createTestApp({ quoteService });
    const started = Date.now();
    const res = await request(app).get('/api/quotes/random');
    expect(res.body.data.source).toBe('fallback');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(quoteService.status.error).toBe('TIMEOUT');
  });

  test('rejects an unknown context with 400', async () => {
    const res = await request(createTestApp().app).get('/api/quotes/random?context=<script>');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/status', () => {
  test('reports measured status of both APIs without calling them', async () => {
    const fetchQuotes = jest.fn();
    const quoteService = new QuoteService({ fetchQuotes });
    const puzzleService = new PuzzleService({ fetchPuzzle: jest.fn() });
    puzzleService.lastStatus = { source: 'banana', latencyMs: 321, error: null, at: 'now' };
    const { app } = createTestApp({ quoteService, puzzleService });
    const res = await request(app).get('/api/status');
    expect(res.body.data.banana).toMatchObject({ source: 'banana', latencyMs: 321 });
    expect(res.body.data.quotes).toMatchObject({ source: null });
    expect(fetchQuotes).not.toHaveBeenCalled();
  });
});
