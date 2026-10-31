// Data access for quiz_attempts: Knowledge Arena results recorded by the
// server itself when rewards are claimed.
class QuizAttemptRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async record({ userId, gameSessionId = null, wave, difficulty, correct, total }) {
    const [result] = await this.pool.execute(
      'INSERT INTO quiz_attempts (user_id, game_session_id, wave, difficulty, correct, total) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, gameSessionId, wave, difficulty, correct, total],
    );
    return result.insertId;
  }

  // Server-verified arena totals for one game.
  async totalsForSession(gameSessionId) {
    const [rows] = await this.pool.execute(
      'SELECT COALESCE(SUM(correct), 0) AS correct, COALESCE(SUM(total), 0) AS total FROM quiz_attempts WHERE game_session_id = ?',
      [gameSessionId],
    );
    return { correct: Number(rows[0].correct), total: Number(rows[0].total) };
  }

  // Lifetime totals used by achievements.
  async userTotals(userId) {
    const [rows] = await this.pool.execute(
      `SELECT COALESCE(SUM(correct), 0) AS correct,
              COALESCE(SUM(total), 0) AS total,
              COALESCE(SUM(correct = total), 0) AS perfectCount,
              COALESCE(SUM(wave = 5 AND difficulty = 'hard' AND correct = total), 0) AS legendaryCount
       FROM quiz_attempts WHERE user_id = ?`,
      [userId],
    );
    return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
  }
}

module.exports = { QuizAttemptRepository };
