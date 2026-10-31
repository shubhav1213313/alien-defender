const { AppError } = require('../errors');

const ROLES = ['player', 'admin'];

function positiveId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new AppError(`${name} must be a positive integer`, 400);
  return id;
}

// Admin dashboard rules. Access is already restricted to admins by the
// requireRole middleware; this layer protects against mistakes, such as an
// admin removing their own access and locking everyone out.
class AdminService {
  constructor({ admin, users, apiStatus }) {
    this.admin = admin;
    this.users = users;
    this.apiStatus = apiStatus; // () => { banana, quotes }
  }

  async overview() {
    return { counts: await this.admin.overview(), apis: this.apiStatus() };
  }

  listUsers() {
    return this.admin.listUsers(50);
  }

  async changeRole(actingUser, targetId, role) {
    const id = positiveId(targetId, 'user id');
    if (!ROLES.includes(role)) throw new AppError('role must be player or admin', 400);
    if (id === actingUser.id) throw new AppError('You cannot change your own role', 400);
    const target = await this.users.findById(id);
    if (!target) throw new AppError('User not found', 404);
    if (target.role === 'admin' && role === 'player' && (await this.admin.countAdmins()) <= 1) {
      throw new AppError('Cannot remove the last admin', 400);
    }
    await this.admin.setRole(id, role);
    return this.users.findById(id);
  }

  recentScores() {
    return this.admin.recentScores(20);
  }

  // Moderation: remove a score (e.g. an obviously cheated one) from the
  // leaderboard.
  async deleteScore(scoreId) {
    const id = positiveId(scoreId, 'score id');
    if (!(await this.admin.deleteScore(id))) throw new AppError('Score not found', 404);
    return { deleted: id };
  }
}

module.exports = { AdminService, ROLES };
