const bcrypt = require('bcrypt');
const { AppError } = require('../errors');
const { validateRegistration, validateLogin } = require('../validation/authValidation');

// Registration and login. Passwords are hashed with bcrypt (salted, slow by
// design) and never stored or logged in plain text.
class AuthService {
  constructor({ users, bcryptRounds = 12 }) {
    this.users = users;
    this.rounds = bcryptRounds;
    // Used to spend the same time on unknown usernames as on wrong
    // passwords, so response time does not reveal which accounts exist.
    this.dummyHash = bcrypt.hashSync('timing-equaliser-password', bcryptRounds);
  }

  async register(body) {
    const input = validateRegistration(body);
    const passwordHash = await bcrypt.hash(input.password, this.rounds);
    try {
      const id = await this.users.create({ ...input, passwordHash });
      return this.users.findById(id);
    } catch (err) {
      // The UNIQUE constraints in MySQL are the source of truth for duplicates.
      if (err.code === 'ER_DUP_ENTRY') {
        const field = /email/i.test(err.message) ? 'email' : 'username';
        const message = field === 'email' ? 'That email is already registered' : 'That username is already taken';
        throw new AppError(message, 409, { [field]: message });
      }
      throw err;
    }
  }

  async login(body) {
    const { identifier, password } = validateLogin(body);
    const user = await this.users.findForLogin(identifier.toLowerCase().includes('@') ? identifier.toLowerCase() : identifier);
    const valid = await bcrypt.compare(password, user ? user.passwordHash : this.dummyHash);
    if (!user || !valid) {
      // Same message either way: do not reveal whether the username exists.
      throw new AppError('Invalid username or password', 401);
    }
    await this.users.updateLastLogin(user.id);
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}

module.exports = { AuthService };
