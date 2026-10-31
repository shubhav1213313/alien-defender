// Data access for the users table. Every query uses ? placeholders, so user
// input is never concatenated into SQL (prevents SQL injection).
const PUBLIC_COLUMNS = 'id, username, email, role, avatar, created_at AS createdAt, last_login_at AS lastLoginAt';

class UserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ username, email, passwordHash, avatar = 'falcon' }) {
    const [result] = await this.pool.execute(
      'INSERT INTO users (username, email, password_hash, avatar) VALUES (?, ?, ?, ?)',
      [username, email, passwordHash, avatar],
    );
    return result.insertId;
  }

  async findById(id) {
    const [rows] = await this.pool.execute(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  // Login accepts a username or an email address. Includes the hash, so it
  // is only ever used inside AuthService.
  async findForLogin(identifier) {
    const [rows] = await this.pool.execute(
      `SELECT ${PUBLIC_COLUMNS}, password_hash AS passwordHash FROM users WHERE username = ? OR email = ? LIMIT 1`,
      [identifier, identifier],
    );
    return rows[0] || null;
  }

  async updateLastLogin(id) {
    await this.pool.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
  }
}

module.exports = { UserRepository };
