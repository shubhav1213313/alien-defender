// Client for Marc Conrad's Banana puzzle API.
// Verified behaviour (2026-10-31):
//   GET https://marcconrad.com/uob/banana/api.php?out=json&base64=yes
//   -> { "question": "<base64 PNG>", "solution": <integer 0-9> }
// Only `out` (json|csv) and `base64` (yes|no) parameters exist - the API has
// NO difficulty setting. The response is sent with Content-Type text/html,
// so we read it as text and parse the JSON ourselves.
// base64=yes means the browser never loads images from a third-party host.
const BANANA_URL = 'https://marcconrad.com/uob/banana/api.php?out=json&base64=yes';

class BananaApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BananaApiError';
    this.code = code; // TIMEOUT | NETWORK | HTTP_ERROR | INVALID_RESPONSE
  }
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

// Validates the raw response text and converts it into { image, solution }.
function parseBananaResponse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BananaApiError('Banana API returned invalid JSON', 'INVALID_RESPONSE');
  }
  if (!data || typeof data.question !== 'string' || data.question.length === 0) {
    throw new BananaApiError('Banana API response has no question', 'INVALID_RESPONSE');
  }
  const solution = Number(data.solution);
  if (!Number.isInteger(solution) || solution < 0 || solution > 999) {
    throw new BananaApiError('Banana API response has an invalid solution', 'INVALID_RESPONSE');
  }

  let image;
  if (/^https?:\/\//.test(data.question)) {
    image = data.question; // base64=no form
  } else if (BASE64_PATTERN.test(data.question)) {
    image = `data:image/png;base64,${data.question}`;
  } else {
    throw new BananaApiError('Banana API question is not an image', 'INVALID_RESPONSE');
  }
  return { image, solution };
}

// Fetches one puzzle, aborting after timeoutMs. Measures real latency.
async function fetchBananaPuzzle({ fetchImpl = fetch, timeoutMs = 4000, url = BANANA_URL } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  let text;
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new BananaApiError(`Banana API responded with HTTP ${response.status}`, 'HTTP_ERROR');
    text = await response.text();
  } catch (err) {
    if (err instanceof BananaApiError) throw err;
    if (err.name === 'AbortError') throw new BananaApiError(`Banana API timed out after ${timeoutMs}ms`, 'TIMEOUT');
    throw new BananaApiError(`Banana API network error: ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  return { ...parseBananaResponse(text), source: 'banana', latencyMs: Date.now() - started };
}

module.exports = { BANANA_URL, BananaApiError, parseBananaResponse, fetchBananaPuzzle };
