// In-memory versions of the four repositories, with the same method names
// and return shapes as the MySQL ones. Used by API tests so they run without
// a database. The real SQL is tested separately in tests/db (needs MySQL).
const ACHIEVEMENTS = [
  ['first_blood', 'First Blood', '🎯'], ['alien_hunter', 'Alien Hunter', '👾'], ['wave_survivor', 'Wave Survivor', '🌊'],
  ['boss_slayer', 'Boss Slayer', '🛸'], ['first_victory', 'First Victory', '🏆'], ['combo_master', 'Combo Master', '🔥'],
  ['perfect_quiz', 'Perfect Quiz', '🧠'], ['knowledge_master', 'Knowledge Master', '📚'], ['hard_victory', 'Hardened Defender', '💀'],
  ['legendary_defender', 'Legendary Defender', '👑'], ['storm_caller', 'Storm Caller', '⚡'],
].map(([id, name, icon]) => ({ id, name, description: `${name} description`, icon }));

function duplicate(key) {
  return Object.assign(new Error(`Duplicate entry for key 'users.${key}'`), { code: 'ER_DUP_ENTRY' });
}

// `now` should be the same clock the app uses, so durations are exact.
function createMemoryRepositories({ now = () => Date.now() } = {}) {
  const users = [];
  const sessions = [];
  const scores = [];
  const quiz = [];
  const unlocked = [];
  const pub = ({ passwordHash, ...u }) => ({ ...u });

  return {
    data: { users, sessions, scores, quiz, unlocked },
    users: {
      async create({ username, email, passwordHash, avatar }) {
        if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw duplicate('uq_users_username');
        if (users.some((u) => u.email === email)) throw duplicate('uq_users_email');
        const user = { id: users.length + 1, username, email, passwordHash, role: 'player', avatar, createdAt: new Date(), lastLoginAt: null };
        users.push(user);
        return user.id;
      },
      async findById(id) {
        const u = users.find((x) => x.id === id);
        return u ? pub(u) : null;
      },
      async findForLogin(identifier) {
        const u = users.find((x) => x.username.toLowerCase() === identifier.toLowerCase() || x.email === identifier);
        return u ? { ...u } : null;
      },
      async updateLastLogin(id) {
        users.find((x) => x.id === id).lastLoginAt = new Date();
      },
    },
    games: {
      async startSession(userId, difficulty) {
        sessions.push({ id: sessions.length + 1, userId, difficulty, startedAt: new Date(now()), finishedAt: null });
        return sessions.length;
      },
      async findSession(id) {
        const s = sessions.find((x) => x.id === id);
        return s ? { ...s } : null;
      },
      async finishSession(sessionId, row) {
        const s = sessions.find((x) => x.id === sessionId);
        if (!s || s.finishedAt) return null;
        s.finishedAt = new Date();
        scores.push({ id: scores.length + 1, ...row, gameSessionId: sessionId, createdAt: new Date() });
        return scores.length;
      },
      async bestScore(userId, difficulty) {
        const mine = scores.filter((s) => s.userId === userId && s.difficulty === difficulty);
        return mine.length ? Math.max(...mine.map((s) => s.score)) : null;
      },
      async recentScores(userId, limit) {
        return scores.filter((s) => s.userId === userId).reverse().slice(0, limit);
      },
      async userStats(userId) {
        const mine = scores.filter((s) => s.userId === userId);
        const sum = (f) => mine.reduce((n, s) => n + Number(s[f]), 0);
        return {
          gamesPlayed: mine.length, highScore: mine.length ? Math.max(...mine.map((s) => s.score)) : 0,
          enemiesDestroyed: sum('enemiesDestroyed'), bossVictories: sum('bossDefeated'),
          victories: mine.filter((s) => s.outcome === 'victory').length, arenaCorrect: sum('arenaCorrect'),
          arenaQuestions: sum('arenaQuestions'), shotsHit: sum('shotsHit'), shotsFired: sum('shotsFired'),
          bestCombo: mine.length ? Math.max(...mine.map((s) => s.maxCombo)) : 0, secondsPlayed: sum('durationSeconds'),
        };
      },
      async leaderboard({ difficulty, limit }) {
        const best = new Map();
        for (const s of scores) {
          if (difficulty !== 'all' && s.difficulty !== difficulty) continue;
          const cur = best.get(s.userId);
          if (!cur || s.score > cur.score) best.set(s.userId, s);
        }
        return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((s, i) => ({
          rank: i + 1, username: users.find((u) => u.id === s.userId).username, avatar: 'falcon',
          difficulty: s.difficulty, score: s.score, waveReached: s.waveReached, bossDefeated: s.bossDefeated, createdAt: s.createdAt,
        }));
      },
    },
    quizAttempts: {
      async record(row) {
        quiz.push(row);
        return quiz.length;
      },
      async totalsForSession(gameSessionId) {
        const mine = quiz.filter((q) => q.gameSessionId === gameSessionId);
        return { correct: mine.reduce((n, q) => n + q.correct, 0), total: mine.reduce((n, q) => n + q.total, 0) };
      },
      async userTotals(userId) {
        const mine = quiz.filter((q) => q.userId === userId);
        return {
          correct: mine.reduce((n, q) => n + q.correct, 0),
          total: mine.reduce((n, q) => n + q.total, 0),
          perfectCount: mine.filter((q) => q.kind !== 'special' && q.correct === q.total).length,
          legendaryCount: mine.filter((q) => q.kind === 'bonus' && q.difficulty === 'hard' && q.correct === q.total).length,
          specialSolved: mine.filter((q) => q.kind === 'special' && q.correct === q.total).length,
        };
      },
    },
    admin: {
      async overview() {
        return {
          users: users.length, admins: users.filter((u) => u.role === 'admin').length,
          gamesStarted: sessions.length, gamesFinished: scores.length, gamesLast24h: sessions.length,
          arenasPlayed: quiz.length, puzzlesSolved: quiz.reduce((n, q) => n + q.correct, 0), trophiesUnlocked: unlocked.length,
        };
      },
      async listUsers(limit) {
        return users.slice().reverse().slice(0, limit).map((u) => {
          const mine = scores.filter((s) => s.userId === u.id);
          return { ...pub(u), gamesPlayed: mine.length, bestScore: mine.length ? Math.max(...mine.map((s) => s.score)) : 0 };
        });
      },
      async countAdmins() {
        return users.filter((u) => u.role === 'admin').length;
      },
      async setRole(userId, role) {
        const u = users.find((x) => x.id === userId);
        if (!u) return false;
        u.role = role;
        return true;
      },
      async recentScores(limit) {
        return scores.slice().reverse().slice(0, limit).map((s) => ({
          id: s.id, username: users.find((u) => u.id === s.userId).username, difficulty: s.difficulty,
          outcome: s.outcome, score: s.score, waveReached: s.waveReached, durationSeconds: s.durationSeconds, createdAt: s.createdAt,
        }));
      },
      async deleteScore(id) {
        const i = scores.findIndex((s) => s.id === id);
        if (i === -1) return false;
        scores.splice(i, 1);
        return true;
      },
    },
    achievements: {
      async all() {
        return ACHIEVEMENTS;
      },
      async forUser(userId) {
        return ACHIEVEMENTS.map((a) => {
          const u = unlocked.find((x) => x.userId === userId && x.id === a.id);
          return { ...a, unlockedAt: u ? u.at : null, unlocked: Boolean(u) };
        });
      },
      async unlock(userId, ids) {
        const added = ids.filter((id) => !unlocked.some((x) => x.userId === userId && x.id === id));
        added.forEach((id) => unlocked.push({ userId, id, at: new Date() }));
        return added;
      },
    },
  };
}

module.exports = { createMemoryRepositories };
