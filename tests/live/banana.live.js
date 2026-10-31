// LIVE test - calls the REAL Banana API over the internet.
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

  test('full arena over HTTP uses live puzzles (not the offline fallback)', async () => {
    const { app } = createTestApp(); // real Banana API, in-memory DB
    const created = await request(app).post('/api/challenges').send({ wave: 1, difficulty: 'normal' }).expect(201);
    const id = created.body.data.arenaId;
    const sources = [];
    for (let i = 0; i < 4; i += 1) {
      const q = await request(app).get(`/api/challenges/${id}/question`).expect(200);
      sources.push(`${q.body.data.source}(${q.body.data.latencyMs}ms)`);
      await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: 0 }).expect(200);
    }
    console.log(`Live arena question sources: ${sources.join(', ')}`);
    expect(sources.every((s) => s.startsWith('banana'))).toBe(true);
    await request(app).post(`/api/challenges/${id}/claim`).expect(200);
  });
});
