// MOCKED tests for the ZenQuotes integration (no network).
const { QuoteService, parseQuotes, fetchZenQuotes, QuotesApiError, QUOTES_URL, FALLBACK_QUOTES } = require('../../src/services/quoteService');

// Shapes copied from real responses captured on 2026-10-31.
const REAL_BATCH = JSON.stringify([
  { q: 'Without the rain there would be no rainbow.', a: 'Gilbert Chesterton', c: '43', h: '<blockquote>&ldquo;Without the rain...</blockquote>' },
  { q: 'Nothing is particularly hard if you divide it into small jobs.', a: 'Henry Ford', c: '62', h: '<blockquote>...</blockquote>' },
]);
const REAL_RATE_LIMIT = JSON.stringify([
  { q: 'Too many requests. Obtain an auth key for unlimited access.', a: 'zenquotes.io', h: 'Too many requests. Obtain an auth key for unlimited access @ zenquotes.io' },
]);
const textResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const quiet = { warn: jest.fn() };

describe('parseQuotes', () => {
  test('keeps text and author only (never the HTML field)', () => {
    expect(parseQuotes(REAL_BATCH)).toEqual([
      { quote: 'Without the rain there would be no rainbow.', author: 'Gilbert Chesterton' },
      { quote: 'Nothing is particularly hard if you divide it into small jobs.', author: 'Henry Ford' },
    ]);
  });

  test('detects the rate-limit reply ZenQuotes sends with HTTP 200', () => {
    expect(() => parseQuotes(REAL_RATE_LIMIT)).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }));
  });

  test.each([
    ['not json'],
    ['{"q":"x"}'],
    ['[]'],
    [JSON.stringify([{ q: 42, a: 'x' }, { q: 'ok' }])],
    [JSON.stringify([{ q: 'x'.repeat(301), a: 'Too long' }])],
  ])('rejects unusable response %s', (body) => {
    expect(() => parseQuotes(body)).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });
});

describe('fetchZenQuotes', () => {
  test('calls the batch endpoint and measures latency', async () => {
    const fetchImpl = jest.fn(async () => textResponse(REAL_BATCH));
    const result = await fetchZenQuotes({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://zenquotes.io/api/quotes', expect.anything());
    expect(QUOTES_URL).toBe('https://zenquotes.io/api/quotes');
    expect(result.quotes).toHaveLength(2);
    expect(typeof result.latencyMs).toBe('number');
  });

  test.each([
    [async () => textResponse('', 429), 'RATE_LIMITED'],
    [async () => textResponse('', 500), 'HTTP_ERROR'],
    [async () => { throw new TypeError('fetch failed'); }, 'NETWORK'],
  ])('maps failures to error codes (%#)', async (fetchImpl, code) => {
    await expect(fetchZenQuotes({ fetchImpl })).rejects.toMatchObject({ code });
  });

  test('times out a hung request (default 3 s, here 50 ms)', async () => {
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await expect(fetchZenQuotes({ fetchImpl, timeoutMs: 50 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('QuoteService caching and fallback', () => {
  function service(fetchQuotes, opts = {}) {
    let clock = 0;
    const s = new QuoteService({ fetchQuotes, now: () => clock, rng: () => 0, logger: quiet, ...opts });
    return { s, advance: (ms) => { clock += ms; } };
  }
  const ok = (quotes = [{ quote: 'Q1', author: 'A1' }]) => jest.fn(async () => ({ quotes, latencyMs: 120 }));
  const failing = (code = 'NETWORK') => jest.fn(async () => { throw new QuotesApiError('fail', code); });

  test('serves ZenQuotes quotes with attribution and records latency', async () => {
    const { s } = service(ok());
    expect(await s.getQuote('menu')).toMatchObject({ quote: 'Q1', author: 'A1', source: 'zenquotes', stale: false,
      attribution: { url: 'https://zenquotes.io/' } });
    expect(s.status).toMatchObject({ source: 'zenquotes', latencyMs: 120, cachedQuotes: 1, error: null });
  });

  test('one API call serves many requests until the 1-hour cache expires', async () => {
    const fetchQuotes = ok();
    const { s, advance } = service(fetchQuotes);
    for (let i = 0; i < 20; i += 1) await s.getQuote();
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    advance(60 * 60 * 1000 + 1);
    await s.getQuote();
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  test('concurrent requests share a single API call', async () => {
    const fetchQuotes = ok();
    const { s } = service(fetchQuotes);
    await Promise.all(Array.from({ length: 10 }, () => s.getQuote()));
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
  });

  test('with no cache and the API down, context-specific fallback quotes are used', async () => {
    const { s } = service(failing('TIMEOUT'));
    const q = await s.getQuote('gameover');
    expect(q).toMatchObject({ source: 'fallback', attribution: null, context: 'gameover' });
    expect(FALLBACK_QUOTES.gameover.map((f) => f.quote)).toContain(q.quote);
    expect(s.status.error).toBe('TIMEOUT');
  });

  test('after a failure it waits 60 s before calling the API again (rate-limit friendly)', async () => {
    const fetchQuotes = failing('RATE_LIMITED');
    const { s, advance } = service(fetchQuotes);
    await s.getQuote();
    await s.getQuote();
    expect(fetchQuotes).toHaveBeenCalledTimes(1);
    advance(61 * 1000);
    await s.getQuote();
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });

  test('a failed refresh keeps serving the old cache, marked stale', async () => {
    let calls = 0;
    const fetchQuotes = jest.fn(async () => {
      calls += 1;
      if (calls === 1) return { quotes: [{ quote: 'Cached', author: 'Old' }], latencyMs: 50 };
      throw new QuotesApiError('down', 'NETWORK');
    });
    const { s, advance } = service(fetchQuotes);
    await s.getQuote();
    advance(2 * 60 * 60 * 1000);
    expect(await s.getQuote()).toMatchObject({ quote: 'Cached', source: 'zenquotes', stale: true });
  });

  test('unknown context falls back to menu', async () => {
    const { s } = service(failing());
    expect((await s.getQuote('nonsense')).context).toBe('menu');
  });
});
