// Data access for achievements and user_achievements.
class AchievementRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async all() {
    const [rows] = await this.pool.execute('SELECT id, name, description, icon FROM achievements ORDER BY sort_order');
    return rows;
  }

  // Full catalogue with this player's unlock time (null = still locked).
  async forUser(userId) {
    const [rows] = await this.pool.execute(
      `SELECT a.id, a.name, a.description, a.icon, ua.unlocked_at AS unlockedAt
       FROM achievements a
       LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ?
       ORDER BY a.sort_order`,
      [userId],
    );
    return rows.map((r) => ({ ...r, unlocked: r.unlockedAt !== null }));
  }

  // Unlocks achievements, ignoring ones already owned. Returns only the ids
  // that are new for this player.
  async unlock(userId, achievementIds, gameSessionId = null) {
    const unlocked = [];
    for (const id of achievementIds) {
      const [result] = await this.pool.execute(
        'INSERT IGNORE INTO user_achievements (user_id, achievement_id, game_session_id) VALUES (?, ?, ?)',
        [userId, id, gameSessionId],
      );
      if (result.affectedRows === 1) unlocked.push(id);
    }
    return unlocked;
  }
}

module.exports = { AchievementRepository };
