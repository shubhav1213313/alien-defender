// Motivational quotes from the ZenQuotes API (second external API).
//
// Verified behaviour and terms (2026-10-31, https://docs.zenquotes.io):
//   GET https://zenquotes.io/api/quotes -> [{ q: text, a: author, c, h }, ...] (50 quotes)
//   - Free tier: 5 requests per 30 seconds per IP.
//   - Attribution with a link to https://zenquotes.io/ is required.
//   - No CORS headers without an API key, so it must be called server-side.
//   - Recommended: cache a batch and refresh about hourly.
//   - When rate limited it still answers HTTP 200, with a fake quote
//     "Too many requests..." by "zenquotes.io" - detected below.
//
// Design: one batch call fills an in-memory cache that serves every player.
// Refreshes are single-flight (concurrent callers share one request), and a
// failed refresh backs off before retrying. If there is no cached data at
// all, built-in fallback quotes are used, so the game never waits on this API.
const QUOTES_URL = 'https://zenquotes.io/api/quotes';
const ATTRIBUTION = Object.freeze({ text: 'Inspirational quotes provided by ZenQuotes API', url: 'https://zenquotes.io/' });
const CONTEXTS = ['menu', 'gameover', 'victory'];

// Our own lines, used only when ZenQuotes cannot be reached.
const FALLBACK_QUOTES = {
  menu: [
    { quote: 'Every defender starts with a single shot.', author: 'Alien Defender' },
    { quote: 'Earth is counting on you, pilot.', author: 'Alien Defender' },
    { quote: 'Knowledge is the sharpest weapon in the fleet.', author: 'Alien Defender' },
  ],
  gameover: [
    { quote: 'The invasion won this round. The next one is yours.', author: 'Alien Defender' },
    { quote: 'Every fallen defender learns the enemy a little better.', author: 'Alien Defender' },
    { quote: 'Regroup, recharge, return.', author: 'Alien Defender' },
  ],
  victory: [
    { quote: 'The skies are quiet tonight - because of you.', author: 'Alien Defender' },
    { quote: 'Legends are written by those who refuse to give up.', author: 'Alien Defender' },
  ],
};

class QuotesApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'QuotesApiError';
    this.code = code; // TIMEOUT | NETWORK | HTTP_ERROR | INVALID_RESPONSE | RATE_LIMITED
  }
}

// Keeps only well-formed quotes. We never use the API's HTML field (`h`).
function parseQuotes(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new QuotesApiError('ZenQuotes returned invalid JSON', 'INVALID_RESPONSE');
  }
  if (!Array.isArray(data)) throw new QuotesApiError('ZenQuotes response is not a list', 'INVALID_RESPONSE');
  if (data.some((item) => item && /too many requests/i.test(item.q) && item.a === 'zenquotes.io')) {
    throw new QuotesApiError('ZenQuotes rate limit reached', 'RATE_LIMITED');
  }
  const quotes = data
    .filter((item) => item && typeof item.q === 'string' && typeof item.a === 'string')
    .map((item) => ({ quote: item.q.trim(), author: item.a.trim() }))
    .filter((item) => item.quote.length > 0 && item.quote.length <= 300 && item.author.length > 0 && item.author.length <= 100);
  if (quotes.length === 0) throw new QuotesApiError('ZenQuotes returned no usable quotes', 'INVALID_RESPONSE');
  return quotes;
}

async function fetchZenQuotes({ fetchImpl = fetch, timeoutMs = 3000, url = QUOTES_URL } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  let text;
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (response.status === 429) throw new QuotesApiError('ZenQuotes rate limit reached', 'RATE_LIMITED');
    if (!response.ok) throw new QuotesApiError(`ZenQuotes responded with HTTP ${response.status}`, 'HTTP_ERROR');
    text = await response.text();
  } catch (err) {
    if (err instanceof QuotesApiError) throw err;
    if (err.name === 'AbortError') throw new QuotesApiError(`ZenQuotes timed out after ${timeoutMs}ms`, 'TIMEOUT');
    throw new QuotesApiError(`ZenQuotes network error: ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  return { quotes: parseQuotes(text), latencyMs: Date.now() - started };
}

class QuoteService {
  constructor({
    fetchQuotes = fetchZenQuotes,
    timeoutMs = 3000,
    ttlMs = 60 * 60 * 1000, // refresh hourly, as the ZenQuotes docs recommend
    retryAfterMs = 60 * 1000, // wait after a failure (respects the rate limit)
    now = () => Date.now(),
    rng = Math.random,
    logger = console,
  } = {}) {
    this.fetchQuotes = fetchQuotes;
    this.timeoutMs = timeoutMs;
    this.ttlMs = ttlMs;
    this.retryAfterMs = retryAfterMs;
    this.now = now;
    this.rng = rng;
    this.logger = logger;
    this.cache = [];
    this.fetchedAt = 0;
    this.lastAttemptAt = null; // null = never tried
    this.inFlight = null;
    this.status = { source: null, latencyMs: null, error: null, cachedQuotes: 0, fetchedAt: null };
  }

  get isFresh() {
    return this.cache.length > 0 && this.now() - this.fetchedAt < this.ttlMs;
  }

  // Refreshes the cache if it is stale. Never throws.
  async refresh() {
    if (this.isFresh) return;
    // Back off after a failure instead of calling a struggling API again.
    if (this.status.error && this.lastAttemptAt !== null && this.now() - this.lastAttemptAt < this.retryAfterMs) return;
    if (!this.inFlight) {
      this.lastAttemptAt = this.now();
      this.inFlight = this.fetchQuotes({ timeoutMs: this.timeoutMs })
        .then(({ quotes, latencyMs }) => {
          this.cache = quotes;
          this.fetchedAt = this.now();
          this.status = { source: 'zenquotes', latencyMs, error: null, cachedQuotes: quotes.length, fetchedAt: new Date(this.fetchedAt).toISOString() };
        })
        .catch((err) => {
          this.logger.warn(`[quotes] ZenQuotes unavailable (${err.code || err.name}): ${err.message}`);
          this.status = { ...this.status, error: err.code || 'UNKNOWN' };
        })
        .finally(() => { this.inFlight = null; });
    }
    await this.inFlight;
  }

  async getQuote(context = 'menu') {
    if (!CONTEXTS.includes(context)) context = 'menu';
    await this.refresh();
    const fromApi = this.cache.length > 0;
    const pool = fromApi ? this.cache : FALLBACK_QUOTES[context];
    const pick = pool[Math.floor(this.rng() * pool.length)];
    return {
      ...pick,
      context,
      source: fromApi ? 'zenquotes' : 'fallback',
      stale: fromApi && !this.isFresh, // served from an older cache after a failed refresh
      attribution: fromApi ? ATTRIBUTION : null,
    };
  }
}

module.exports = { QuoteService, QuotesApiError, parseQuotes, fetchZenQuotes, QUOTES_URL, ATTRIBUTION, FALLBACK_QUOTES, CONTEXTS };
