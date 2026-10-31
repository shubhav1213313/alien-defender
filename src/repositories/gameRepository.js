// Data access for game_sessions and scores.
const DIFFICULTY_FILTERS = ['all', 'easy', 'normal', 'hard'];

class GameRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async startSession(userId, difficulty) {
    const [result] = await this.pool.execute(
      'INSERT INTO game_sessions (user_id, difficulty) VALUES (?, ?)',
      [userId, difficulty],
    );
    return result.insertId;
  }

  async findSession(id) {
    const [rows] = await this.pool.execute(
      'SELECT id, user_id AS userId, difficulty, started_at AS startedAt, finished_at AS finishedAt FROM game_sessions WHERE id = ?',
      [id],
    );
    return rows[0] || null;
  }

  // Closes the session and stores its score atomically. The
  // "finished_at IS NULL" condition means a session can only be scored once,
  // even if two requests arrive at the same moment.
  async finishSession(sessionId, s) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [update] = await connection.execute(
        'UPDATE game_sessions SET finished_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND finished_at IS NULL',
        [sessionId],
      );
      if (update.affectedRows !== 1) {
        await connection.rollback();
        return null;
      }
      const [insert] = await connection.execute(
        `INSERT INTO scores (game_session_id, user_id, difficulty, outcome, score, wave_reached, enemies_destroyed,
           max_combo, shots_fired, shots_hit, boss_defeated, arena_correct, arena_questions, abilities_used, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, s.userId, s.difficulty, s.outcome, s.score, s.waveReached, s.enemiesDestroyed, s.maxCombo,
          s.shotsFired, s.shotsHit, s.bossDefeated, s.arenaCorrect, s.arenaQuestions, s.abilitiesUsed, s.durationSeconds],
      );
      await connection.commit();
      return insert.insertId;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  async bestScore(userId, difficulty) {
    const [rows] = await this.pool.execute(
      'SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND difficulty = ?',
      [userId, difficulty],
    );
    return rows[0].best === null ? null : Number(rows[0].best);
  }

  async recentScores(userId, limit = 10) {
    // pool.query (client-side escaping, still parameterised) because MySQL
    // prepared statements reject a numeric LIMIT placeholder.
    const [rows] = await this.pool.query(
      `SELECT id, difficulty, outcome, score, wave_reached AS waveReached, enemies_destroyed AS enemiesDestroyed,
              boss_defeated AS bossDefeated, arena_correct AS arenaCorrect, arena_questions AS arenaQuestions,
              duration_seconds AS durationSeconds, created_at AS createdAt
       FROM scores WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [userId, limit],
    );
    return rows.map((r) => ({ ...r, bossDefeated: Boolean(r.bossDefeated) }));
  }

  // Lifetime statistics for the profile page.
  async userStats(userId) {
    const [rows] = await this.pool.execute(
      `SELECT COUNT(*) AS gamesPlayed,
              COALESCE(MAX(score), 0) AS highScore,
              COALESCE(SUM(enemies_destroyed), 0) AS enemiesDestroyed,
              COALESCE(SUM(boss_defeated), 0) AS bossVictories,
              COALESCE(SUM(outcome = 'victory'), 0) AS victories,
              COALESCE(SUM(arena_correct), 0) AS arenaCorrect,
              COALESCE(SUM(arena_questions), 0) AS arenaQuestions,
              COALESCE(SUM(shots_hit), 0) AS shotsHit,
              COALESCE(SUM(shots_fired), 0) AS shotsFired,
              COALESCE(MAX(max_combo), 0) AS bestCombo,
              COALESCE(SUM(duration_seconds), 0) AS secondsPlayed
       FROM scores WHERE user_id = ?`,
      [userId],
    );
    // SUM() returns DECIMAL strings in mysql2; convert to numbers.
    return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
  }

  // Each player's single best score, ranked.
  async leaderboard({ difficulty = 'all', limit = 10 } = {}) {
    if (!DIFFICULTY_FILTERS.includes(difficulty)) throw new Error(`Invalid difficulty filter: ${difficulty}`);
    const [rows] = await this.pool.query(
      `SELECT username, avatar, difficulty, score, waveReached, bossDefeated, createdAt FROM (
         SELECT u.username, u.avatar, s.difficulty, s.score, s.wave_reached AS waveReached,
                s.boss_defeated AS bossDefeated, s.created_at AS createdAt,
                ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.score DESC, s.created_at ASC) AS rn
         FROM scores s JOIN users u ON u.id = s.user_id
         WHERE (? = 'all' OR s.difficulty = ?)
       ) ranked
       WHERE rn = 1
       ORDER BY score DESC, createdAt ASC
       LIMIT ?`,
      [difficulty, difficulty, limit],
    );
    return rows.map((r, i) => ({ rank: i + 1, ...r, bossDefeated: Boolean(r.bossDefeated) }));
  }
}

module.exports = { GameRepository, DIFFICULTY_FILTERS };
