const crypto = require('crypto');
const { QUESTIONS_PER_ARENA, FINAL_WAVE, DIFFICULTY_RULES, calculateRewards } = require('./arenaRules');

// Seconds of network grace allowed on top of the visible time limit.
const SUBMIT_GRACE_SECONDS = 3;

class ChallengeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ChallengeError';
    this.status = status;
  }
}

// Runs Knowledge Challenge Arenas. Correct answers never leave the server
// until the player has submitted. Each question accepts exactly one scored
// submission and rewards can be claimed exactly once.
//
// Arenas are kept in memory with a time-to-live. That is enough for a
// single-server game; a database-backed store can replace it later.
class ChallengeService {
  constructor({ puzzleProvider, now = () => Date.now(), ttlMs = 30 * 60 * 1000, idGenerator = () => crypto.randomUUID() }) {
    this.puzzles = puzzleProvider;
    this.now = now;
    this.ttlMs = ttlMs;
    this.newId = idGenerator;
    this.arenas = new Map();
  }

  createArena({ wave, difficulty }) {
    if (!Number.isInteger(wave) || wave < 1 || wave > FINAL_WAVE) {
      throw new ChallengeError(`wave must be an integer from 1 to ${FINAL_WAVE}`, 400);
    }
    if (!Object.prototype.hasOwnProperty.call(DIFFICULTY_RULES, difficulty)) {
      throw new ChallengeError('difficulty must be easy, normal or hard', 400);
    }
    this.removeExpired();
    const arena = {
      id: this.newId(),
      wave,
      difficulty,
      rules: DIFFICULTY_RULES[difficulty],
      questions: [],
      currentIndex: 0,
      correctCount: 0,
      rewardsClaimed: false,
      createdAt: this.now(),
    };
    this.arenas.set(arena.id, arena);
    return this.publicArena(arena);
  }

  getArena(id) {
    const arena = this.arenas.get(id);
    if (!arena || this.now() - arena.createdAt > this.ttlMs) {
      throw new ChallengeError('Challenge not found or expired', 404);
    }
    return arena;
  }

  isComplete(arena) {
    return arena.currentIndex >= QUESTIONS_PER_ARENA;
  }

  publicArena(arena) {
    return {
      arenaId: arena.id,
      wave: arena.wave,
      difficulty: arena.difficulty,
      postBoss: arena.wave === FINAL_WAVE,
      timeLimitSeconds: arena.rules.timeLimitSeconds,
      hintsAllowed: arena.rules.hintsAllowed,
      totalQuestions: QUESTIONS_PER_ARENA,
      answered: arena.currentIndex,
      correct: arena.correctCount,
      completed: this.isComplete(arena),
      rewardsClaimed: arena.rewardsClaimed,
    };
  }

  // Returns the current question, fetching a puzzle the first time. Asking
  // again returns the SAME puzzle, so refreshing cannot reroll a hard one.
  async getQuestion(id) {
    const arena = this.getArena(id);
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
      totalQuestions: QUESTIONS_PER_ARENA,
      image: q.image,
      source: q.source,
      fallbackReason: q.fallbackReason || null,
      latencyMs: q.latencyMs,
      timeLimitSeconds: arena.rules.timeLimitSeconds,
      secondsRemaining: Math.max(0, arena.rules.timeLimitSeconds - Math.floor((this.now() - q.issuedAt) / 1000)),
      hintAvailable: arena.rules.hintsAllowed && !q.hintUsed,
    };
  }

  // One scored submission per question. `answer` null = time ran out.
  submitAnswer(id, { questionIndex, answer }) {
    const arena = this.getArena(id);
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
      explanation: q.explanation || null,
      answered: arena.currentIndex,
      correctCount: arena.correctCount,
      completed: this.isComplete(arena),
    };
  }

  // Easy mode only: narrows the answer down without giving it away.
  useHint(id) {
    const arena = this.getArena(id);
    if (!arena.rules.hintsAllowed) throw new ChallengeError('Hints are only available on Easy', 403);
    if (this.isComplete(arena)) throw new ChallengeError('All questions have been answered', 409);
    const q = arena.questions[arena.currentIndex];
    if (!q) throw new ChallengeError('Question has not been issued yet', 409);
    if (q.hintUsed) throw new ChallengeError('Hint already used for this question', 409);
    q.hintUsed = true;
    const parity = q.solution % 2 === 0 ? 'even' : 'odd';
    const range = q.solution < 5 ? 'less than 5' : '5 or more';
    return { questionIndex: q.index, hint: `The answer is ${parity} and ${range}.` };
  }

  // Rewards are calculated here, on the server, and can be claimed once.
  claimRewards(id) {
    const arena = this.getArena(id);
    if (!this.isComplete(arena)) throw new ChallengeError('Answer all four questions first', 409);
    if (arena.rewardsClaimed) throw new ChallengeError('Rewards already claimed', 409);
    arena.rewardsClaimed = true;
    return { arenaId: arena.id, ...calculateRewards({ wave: arena.wave, difficulty: arena.difficulty, correct: arena.correctCount }) };
  }

  removeExpired() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, arena] of this.arenas) if (arena.createdAt < cutoff) this.arenas.delete(id);
  }
}

module.exports = { ChallengeService, ChallengeError, SUBMIT_GRACE_SECONDS };
