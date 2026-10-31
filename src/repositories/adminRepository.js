// Data access for the admin dashboard (read-mostly, plus moderation).
class AdminRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async overview() {
    const [rows] = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
        (SELECT COUNT(*) FROM game_sessions) AS gamesStarted,
        (SELECT COUNT(*) FROM scores) AS gamesFinished,
        (SELECT COUNT(*) FROM game_sessions WHERE started_at >= NOW() - INTERVAL 1 DAY) AS gamesLast24h,
        (SELECT COUNT(*) FROM quiz_attempts) AS arenasPlayed,
        (SELECT COALESCE(SUM(correct), 0) FROM quiz_attempts) AS puzzlesSolved,
        (SELECT COUNT(*) FROM user_achievements) AS trophiesUnlocked`);
    return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
  }

  async listUsers(limit = 50) {
    const [rows] = await this.pool.query(
      `SELECT u.id, u.username, u.email, u.role, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
              COUNT(s.id) AS gamesPlayed, COALESCE(MAX(s.score), 0) AS bestScore
       FROM users u LEFT JOIN scores s ON s.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
      [limit],
    );
    return rows.map((r) => ({ ...r, gamesPlayed: Number(r.gamesPlayed), bestScore: Number(r.bestScore) }));
  }

  async countAdmins() {
    const [rows] = await this.pool.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    return Number(rows[0].n);
  }

  async setRole(userId, role) {
    const [result] = await this.pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    return result.affectedRows === 1;
  }

  async recentScores(limit = 20) {
    const [rows] = await this.pool.query(
      `SELECT s.id, u.username, s.difficulty, s.outcome, s.score, s.wave_reached AS waveReached,
              s.duration_seconds AS durationSeconds, s.created_at AS createdAt
       FROM scores s JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
      [limit],
    );
    return rows;
  }

  async deleteScore(scoreId) {
    const [result] = await this.pool.execute('DELETE FROM scores WHERE id = ?', [scoreId]);
    return result.affectedRows === 1;
  }
}

module.exports = { AdminRepository };
