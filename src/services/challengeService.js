const crypto = require('crypto');
const { KINDS, DIFFICULTIES, validWave, calculateRewards } = require('./arenaRules');

// Seconds of network grace allowed on top of the visible time limit.
const SUBMIT_GRACE_SECONDS = 3;

class ChallengeError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ChallengeError';
    this.status = status;
    if (code) this.code = code;
  }
}

// Runs Knowledge Challenges. Correct answers never leave the server until
// the player has submitted. Each question accepts exactly one scored
// submission and rewards can be claimed exactly once.
//
// Challenges are kept in memory with a time-to-live (single game server);
// results of logged-in players are stored in MySQL when claimed.
class ChallengeService {
  constructor({ puzzleProvider, now = () => Date.now(), ttlMs = 30 * 60 * 1000, idGenerator = () => crypto.randomUUID() }) {
    this.puzzles = puzzleProvider;
    this.now = now;
    this.ttlMs = ttlMs;
    this.newId = idGenerator;
    this.arenas = new Map();
  }

  // userId / gameSessionId are set when a logged-in player starts the
  // challenge during a recorded game; guests' challenges have neither.
  createArena({ kind = 'wave', wave, difficulty = 'normal', userId = null, gameSessionId = null }) {
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) throw new ChallengeError('kind must be wave, bonus or special', 400);
    if (!Number.isInteger(wave) || !validWave(kind, wave)) throw new ChallengeError(`wave ${wave} is not valid for a ${kind} challenge`, 400);
    if (!DIFFICULTIES.includes(difficulty)) throw new ChallengeError('difficulty must be easy, normal or hard', 400);
    this.removeExpired();
    const arena = {
      id: this.newId(),
      kind,
      wave,
      difficulty,
      rules: KINDS[kind],
      questions: [],
      currentIndex: 0,
      correctCount: 0,
      rewardsClaimed: false,
      createdAt: this.now(),
      userId,
      gameSessionId,
    };
    this.arenas.set(arena.id, arena);
    return this.publicArena(arena);
  }

  // A player's challenge is only visible to that player (404 for anyone
  // else, so ids cannot be probed). Guest challenges rely on their random id.
  getArena(id, requesterId = null) {
    const arena = this.arenas.get(id);
    if (!arena || this.now() - arena.createdAt > this.ttlMs || (arena.userId !== null && arena.userId !== requesterId)) {
      throw new ChallengeError('Challenge not found or expired', 404);
    }
    return arena;
  }

  isComplete(arena) {
    return arena.currentIndex >= arena.rules.questions;
  }

  publicArena(arena) {
    return {
      arenaId: arena.id,
      kind: arena.kind,
      wave: arena.wave,
      difficulty: arena.difficulty,
      timeLimitSeconds: arena.rules.timeLimitSeconds,
      hintsAllowed: arena.rules.hintsAllowed,
      totalQuestions: arena.rules.questions,
      answered: arena.currentIndex,
      correct: arena.correctCount,
      completed: this.isComplete(arena),
      rewardsClaimed: arena.rewardsClaimed,
    };
  }

  // Returns the current question, fetching a genuine Banana puzzle the first
  // time. Asking again returns the SAME puzzle (no rerolling). If the API is
  // down the error propagates (503) and nothing is stored, so Retry works.
  async getQuestion(id, requesterId = null) {
    const arena = this.getArena(id, requesterId);
    if (this.isComplete(arena)) throw new ChallengeError('All questions have been answered', 409);
    const index = arena.currentIndex;
    if (!arena.questions[index]) {
      const puzzle = await this.puzzles.getPuzzle();
      // Another request may have stored a puzzle while we were waiting.
      if (!arena.questions[index]) {
        arena.questions[index] = { ...puzzle, index, issuedAt: this.now(), answered: false, hintUsed: false };
      }
    }
    const q = arena.questions[index];
    return {
      arenaId: arena.id,
      questionIndex: index,
      questionNumber: index + 1,
      totalQuestions: arena.rules.questions,
      image: q.image,
      source: q.source,
      latencyMs: q.latencyMs,
      timeLimitSeconds: arena.rules.timeLimitSeconds,
      secondsRemaining: Math.max(0, arena.rules.timeLimitSeconds - Math.floor((this.now() - q.issuedAt) / 1000)),
      hintAvailable: arena.rules.hintsAllowed && !q.hintUsed,
    };
  }

  // One scored submission per question. `answer` null = time ran out.
  submitAnswer(id, { questionIndex, answer }, requesterId = null) {
    const arena = this.getArena(id, requesterId);
    if (this.isComplete(arena)) throw new ChallengeError('All questions have been answered', 409);
    if (questionIndex !== arena.currentIndex) {
      throw new ChallengeError('This question has already been answered', 409);
    }
    const q = arena.questions[questionIndex];
    if (!q) throw new ChallengeError('Question has not been issued yet', 409);

    const elapsedSeconds = (this.now() - q.issuedAt) / 1000;
    const timedOut = answer === null || elapsedSeconds > arena.rules.timeLimitSeconds + SUBMIT_GRACE_SECONDS;
    const correct = !timedOut && Number(answer) === q.solution;

    q.answered = true;
    arena.currentIndex += 1;
    if (correct) arena.correctCount += 1;

    return {
      questionIndex,
      correct,
      timedOut,
      correctAnswer: q.solution,
      answered: arena.currentIndex,
      totalQuestions: arena.rules.questions,
      correctCount: arena.correctCount,
      completed: this.isComplete(arena),
    };
  }

  // Narrows the answer down without giving it away (not on special puzzles).
  useHint(id, requesterId = null) {
    const arena = this.getArena(id, requesterId);
    if (!arena.rules.hintsAllowed) throw new ChallengeError('The special puzzle has no hints', 403);
    if (this.isComplete(arena)) throw new ChallengeError('All questions have been answered', 409);
    const q = arena.questions[arena.currentIndex];
    if (!q) throw new ChallengeError('Question has not been issued yet', 409);
    if (q.hintUsed) throw new ChallengeError('Hint already used for this question', 409);
    q.hintUsed = true;
    const parity = q.solution % 2 === 0 ? 'even' : 'odd';
    const range = q.solution < 5 ? 'between 0 and 4' : 'between 5 and 9';
    return { questionIndex: q.index, hint: `The answer is an ${parity} number ${range}.` };
  }

  // Rewards are calculated here, on the server, and can be claimed once.
  claimRewards(id, requesterId = null) {
    const arena = this.getArena(id, requesterId);
    if (!this.isComplete(arena)) throw new ChallengeError('Answer every question first', 409);
    if (arena.rewardsClaimed) throw new ChallengeError('Rewards already claimed', 409);
    arena.rewardsClaimed = true;
    return {
      arenaId: arena.id,
      ...calculateRewards({ kind: arena.kind, wave: arena.wave, difficulty: arena.difficulty, correct: arena.correctCount }),
    };
  }

  removeExpired() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, arena] of this.arenas) if (arena.createdAt < cutoff) this.arenas.delete(id);
  }
}

module.exports = { ChallengeService, ChallengeError, SUBMIT_GRACE_SECONDS };
