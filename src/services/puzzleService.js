const { fetchBananaPuzzle } = require('./bananaService');
const { generateOfflinePuzzle } = require('./offlinePuzzleService');

// Resilience layer: try the real Banana API first; if it times out, errors
// or returns something invalid, fall back to a clearly labelled offline
// puzzle so the game can always continue. Records the last outcome so the
// UI can show live API status and measured latency.
class PuzzleService {
  constructor({ fetchPuzzle = fetchBananaPuzzle, fallback = generateOfflinePuzzle, timeoutMs = 4000, logger = console } = {}) {
    this.fetchPuzzle = fetchPuzzle;
    this.fallback = fallback;
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
      this.logger.warn(`[puzzles] Banana API unavailable (${err.code || err.name}): ${err.message}. Using offline puzzle.`);
      this.lastStatus = { source: 'offline', latencyMs: null, error: err.code || 'UNKNOWN', at: new Date().toISOString() };
      return { ...this.fallback(), fallbackReason: err.code || 'UNKNOWN' };
    }
  }
}

module.exports = { PuzzleService };
