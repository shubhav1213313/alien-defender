// LIVE tests - call the REAL Banana and ZenQuotes APIs over the internet.
// Not part of `npm test` (which is fully mocked and offline).
// Run with: npm run test:live
const request = require('supertest');
const { fetchBananaPuzzle } = require('../../src/services/bananaService');
const { createTestApp } = require('../helpers/testApp');

jest.setTimeout(30000);

describe('LIVE: Marc Conrad Banana API', () => {
  test('returns a real PNG puzzle with an integer solution', async () => {
    const puzzle = await fetchBananaPuzzle({ timeoutMs: 10000 });
    expect(puzzle.source).toBe('banana');
    expect(puzzle.image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/); // PNG signature
    expect(Number.isInteger(puzzle.solution)).toBe(true);
    console.log(`Banana API OK - solution ${puzzle.solution}, latency ${puzzle.latencyMs}ms, image ${Math.round(puzzle.image.length / 1024)}KB`);
  });

  // The solution is never sent before answering, so the live test cannot
  // know it in advance: it answers 0 and checks that the server marks the
  // answer and reveals each live puzzle's solution afterwards.
  test.each([
    ['wave', 1, 2],
    ['special', 3, 1],
  ])('%s challenge over HTTP uses %#: live Banana puzzles end to end', async (kind, wave, count) => {
    const { app } = createTestApp(); // real Banana API, in-memory DB
    const created = await request(app).post('/api/challenges').send({ kind, wave }).expect(201);
    expect(created.body.data.totalQuestions).toBe(count);
    const id = created.body.data.arenaId;
    const seen = [];
    for (let i = 0; i < count; i += 1) {
      const q = await request(app).get(`/api/challenges/${id}/question`).expect(200);
      expect(q.body.data.image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
      const a = await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: 0 }).expect(200);
      seen.push(`${q.body.data.source} ${q.body.data.latencyMs}ms -> solution ${a.body.data.correctAnswer}`);
    }
    console.log(`Live ${kind} challenge: ${seen.join(' | ')}`);
    const claim = await request(app).post(`/api/challenges/${id}/claim`).expect(200);
    expect(claim.body.data.total).toBe(count);
  });
});

describe('LIVE: ZenQuotes API', () => {
  const { fetchZenQuotes, QuoteService } = require('../../src/services/quoteService');

  // ONE real call (the free tier allows 5 per 30 seconds). If the limit was
  // already used up by someone on this IP, RATE_LIMITED is reported and
  // the fallback path is verified instead.
  test('batch endpoint returns real quotes, or a correctly detected rate limit', async () => {
    try {
      const { quotes, latencyMs } = await fetchZenQuotes({ timeoutMs: 10000 });
      expect(quotes.length).toBeGreaterThan(10);
      expect(quotes[0]).toEqual({ quote: expect.any(String), author: expect.any(String) });
      console.log(`ZenQuotes OK - ${quotes.length} quotes in ${latencyMs}ms, e.g. "${quotes[0].quote}" - ${quotes[0].author}`);
    } catch (err) {
      expect(err.code).toBe('RATE_LIMITED');
      console.log('ZenQuotes rate limit active - detected correctly');
      const fallback = await new QuoteService({ fetchQuotes: async () => { throw err; }, logger: { warn() {} } }).getQuote('menu');
      expect(fallback.source).toBe('fallback');
    }
  });
});
