const { AppError } = require('../errors');
const { parseResult, checkPlausibility } = require('./scoreValidation');
const { earnedAchievements } = require('./achievementRules');

const DIFFICULTIES = ['easy', 'normal', 'hard'];

// Persists games, scores and achievements for logged-in players.
class ScoreService {
  constructor({ games, quizAttempts, achievements, now = () => Date.now() }) {
    this.games = games;
    this.quizAttempts = quizAttempts;
    this.achievements = achievements;
    this.now = now;
  }

  async startGame(userId, difficulty) {
    if (!DIFFICULTIES.includes(difficulty)) throw new AppError('difficulty must be easy, normal or hard', 400);
    const gameSessionId = await this.games.startSession(userId, difficulty);
    return { gameSessionId, difficulty };
  }

  // A game session the player owns and has not finished yet. Unknown ids and
  // other players' sessions both give 404, so ids cannot be probed.
  async ownedOpenSession(userId, gameSessionId) {
    const id = Number(gameSessionId);
    const session = Number.isInteger(id) && id > 0 ? await this.games.findSession(id) : null;
    if (!session || session.userId !== userId) throw new AppError('Game not found', 404);
    if (session.finishedAt) throw new AppError('This game has already been submitted', 409);
    return session;
  }

  async submitResult(userId, gameSessionId, body) {
    const session = await this.ownedOpenSession(userId, gameSessionId);
    const result = parseResult(body);

    // Measured by the server, not reported by the browser.
    const durationSeconds = Math.max(0, Math.round((this.now() - new Date(session.startedAt).getTime()) / 1000));
    checkPlausibility(result, durationSeconds);
    const arena = await this.quizAttempts.totalsForSession(session.id);

    const previousBest = await this.games.bestScore(userId, session.difficulty);
    const scoreId = await this.games.finishSession(session.id, {
      ...result,
      userId,
      difficulty: session.difficulty,
      arenaCorrect: arena.correct,
      arenaQuestions: arena.total,
      durationSeconds,
    });
    if (!scoreId) throw new AppError('This game has already been submitted', 409);

    const [totals, quiz] = await Promise.all([this.games.userStats(userId), this.quizAttempts.userTotals(userId)]);
    const earned = earnedAchievements({ result, totals, quiz, difficulty: session.difficulty });
    const newIds = await this.achievements.unlock(userId, earned, session.id);
    const catalogue = await this.achievements.all();

    return {
      scoreId,
      score: result.score,
      difficulty: session.difficulty,
      durationSeconds,
      arenaCorrect: arena.correct,
      arenaQuestions: arena.total,
      personalBest: previousBest === null || result.score > previousBest,
      previousBest,
      newAchievements: catalogue.filter((a) => newIds.includes(a.id)),
    };
  }

  // Records a Knowledge Arena result for a logged-in player. Called by the
  // server when rewards are claimed.
  async recordArena({ userId, gameSessionId, wave, difficulty, correct, total }) {
    return this.quizAttempts.record({ userId, gameSessionId, wave, difficulty, correct, total });
  }

  async profile(userId) {
    const [stats, recentScores, achievements] = await Promise.all([
      this.games.userStats(userId),
      this.games.recentScores(userId, 10),
      this.achievements.forUser(userId),
    ]);
    const accuracy = stats.shotsFired ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
    const quizAccuracy = stats.arenaQuestions ? Math.round((stats.arenaCorrect / stats.arenaQuestions) * 100) : 0;
    return { stats: { ...stats, accuracy, quizAccuracy }, recentScores, achievements };
  }

  async leaderboard(query = {}) {
    const difficulty = query.difficulty || 'all';
    if (!['all', ...DIFFICULTIES].includes(difficulty)) throw new AppError('difficulty must be all, easy, normal or hard', 400);
    const limit = query.limit === undefined ? 10 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new AppError('limit must be 1-50', 400);
    return this.games.leaderboard({ difficulty, limit });
  }
}

module.exports = { ScoreService };
