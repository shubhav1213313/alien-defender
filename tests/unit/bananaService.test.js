// MOCKED tests: no network access. fetch is replaced with fakes that behave
// like the real Banana API (including its text/html content type).
const { parseBananaResponse, fetchBananaPuzzle, BananaApiError, BANANA_URL } = require('../../src/services/bananaService');
const { PuzzleService } = require('../../src/services/puzzleService');

// Shape copied from a real response captured on 2026-10-31 (image shortened).
const REAL_SHAPE_BASE64 = '{ "question" : "iVBORw0KGgoAAAANSUhEUgAAApQAAAFo" , "solution" : 5 }';
const REAL_SHAPE_URL = '{ "question" : "https://www.sanfoh.com/uob/banana/data/t2d6b18466c43301e0f9943042en95.png" , "solution" : 5 }';

const textResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

describe('parseBananaResponse (real response format)', () => {
  test('parses the base64 form into a PNG data URI', () => {
    expect(parseBananaResponse(REAL_SHAPE_BASE64)).toEqual({
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAApQAAAFo',
      solution: 5,
    });
  });

  test('also accepts the image-URL form', () => {
    expect(parseBananaResponse(REAL_SHAPE_URL).image).toMatch(/^https:\/\/www\.sanfoh\.com\//);
  });

  test.each([
    ['not json', 'Banana API returned invalid JSON'],
    ['{"solution": 3}', 'no question'],
    ['{"question": "", "solution": 3}', 'no question'],
    ['{"question": "iVBOR", "solution": "seven"}', 'invalid solution'],
    ['{"question": "iVBOR", "solution": -1}', 'invalid solution'],
    ['{"question": "<script>alert(1)</script>", "solution": 1}', 'not an image'],
  ])('rejects invalid response %s', (body, message) => {
    expect(() => parseBananaResponse(body)).toThrow(message);
    try { parseBananaResponse(body); } catch (err) { expect(err.code).toBe('INVALID_RESPONSE'); }
  });
});

describe('fetchBananaPuzzle', () => {
  test('requests the documented endpoint with base64 images', async () => {
    const fetchImpl = jest.fn(async () => textResponse(REAL_SHAPE_BASE64));
    const puzzle = await fetchBananaPuzzle({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(BANANA_URL, expect.objectContaining({ signal: expect.anything() }));
    expect(BANANA_URL).toBe('https://marcconrad.com/uob/banana/api.php?out=json&base64=yes');
    expect(puzzle).toMatchObject({ solution: 5, source: 'banana' });
    expect(typeof puzzle.latencyMs).toBe('number');
  });

  test('HTTP errors become HTTP_ERROR', async () => {
    const fetchImpl = async () => textResponse('oops', 503);
    await expect(fetchBananaPuzzle({ fetchImpl })).rejects.toMatchObject({ code: 'HTTP_ERROR' });
  });

  test('network failures become NETWORK', async () => {
    const fetchImpl = async () => { throw new TypeError('fetch failed'); };
    await expect(fetchBananaPuzzle({ fetchImpl })).rejects.toMatchObject({ code: 'NETWORK' });
  });

  test('a slow API is aborted after the timeout', async () => {
    // Never resolves unless aborted - just like a hung connection.
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const started = Date.now();
    await expect(fetchBananaPuzzle({ fetchImpl, timeoutMs: 50 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('errors are BananaApiError instances', async () => {
    const fetchImpl = async () => textResponse('nope');
    await expect(fetchBananaPuzzle({ fetchImpl })).rejects.toBeInstanceOf(BananaApiError);
  });
});

describe('PuzzleService fallback', () => {
  const quietLogger = { warn: jest.fn() };

  test('returns the Banana puzzle and records its latency when the API works', async () => {
    const service = new PuzzleService({ fetchPuzzle: async () => ({ image: 'data:x', solution: 4, source: 'banana', latencyMs: 321 }), logger: quietLogger });
    const puzzle = await service.getPuzzle();
    expect(puzzle.source).toBe('banana');
    expect(service.lastStatus).toMatchObject({ source: 'banana', latencyMs: 321, error: null });
  });

  // No fabricated puzzles: an outage is reported honestly as 503 so the
  // player can Retry or continue without the ability.
  test.each(['TIMEOUT', 'NETWORK', 'HTTP_ERROR', 'INVALID_RESPONSE'])('reports %s as PUZZLE_API_UNAVAILABLE (no fake puzzle)', async (code) => {
    const service = new PuzzleService({ fetchPuzzle: async () => { throw new BananaApiError('fail', code); }, logger: quietLogger });
    await expect(service.getPuzzle()).rejects.toMatchObject({
      status: 503, expose: true, code: 'PUZZLE_API_UNAVAILABLE', reason: code,
      message: expect.stringMatching(/Retry, or continue without the ability/),
    });
    expect(service.lastStatus).toMatchObject({ source: 'banana', error: code });
  });
});
