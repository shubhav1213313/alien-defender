const { fetchBananaPuzzle } = require('./bananaService');

// Fetches genuine Banana API puzzles. There is deliberately NO fabricated
// fallback puzzle: if the API is unavailable the request fails with a clear
// 503 and the player is offered "Retry" or "Continue without ability".
// Records the last outcome so the UI can show live API status and latency.
class PuzzleUnavailableError extends Error {
  constructor(cause) {
    super('The Banana puzzle service is unavailable right now. Retry, or continue without the ability.');
    this.name = 'PuzzleUnavailableError';
    this.status = 503;
    this.expose = true; // safe message, shown to the player
    this.code = 'PUZZLE_API_UNAVAILABLE';
    this.reason = cause.code || 'UNKNOWN'; // TIMEOUT | NETWORK | HTTP_ERROR | INVALID_RESPONSE
  }
}

class PuzzleService {
  constructor({ fetchPuzzle = fetchBananaPuzzle, timeoutMs = 4000, logger = console } = {}) {
    this.fetchPuzzle = fetchPuzzle;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.lastStatus = { source: null, latencyMs: null, error: null, at: null };
  }

  async getPuzzle() {
    try {
      const puzzle = await this.fetchPuzzle({ timeoutMs: this.timeoutMs });
      this.lastStatus = { source: 'banana', latencyMs: puzzle.latencyMs, error: null, at: new Date().toISOString() };
      return puzzle;
    } catch (err) {
      this.logger.warn(`[puzzles] Banana API unavailable (${err.code || err.name}): ${err.message}`);
      this.lastStatus = { source: 'banana', latencyMs: null, error: err.code || 'UNKNOWN', at: new Date().toISOString() };
      throw new PuzzleUnavailableError(err);
    }
  }
}

module.exports = { PuzzleService, PuzzleUnavailableError };
