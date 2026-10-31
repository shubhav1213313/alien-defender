const { AppError } = require('../errors');

// Input rules for registration and login. All checks run on the server;
// the browser's own checks are only a convenience.
const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
// Deliberately simple: something@something.tld, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const AVATARS = ['falcon', 'nova', 'comet', 'nebula', 'pulsar'];
// bcrypt only uses the first 72 bytes of a password.
const PASSWORD_MAX_BYTES = 72;

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'Password must be at most 72 bytes';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain at least one letter and one number';
  return null;
}

function validateRegistration(body = {}) {
  const errors = {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const avatar = body.avatar === undefined ? 'falcon' : body.avatar;

  if (!USERNAME.test(username)) errors.username = 'Username must be 3-20 letters, numbers or underscores';
  if (email.length > 254 || !EMAIL.test(email)) errors.email = 'Enter a valid email address';
  const passwordError = validatePassword(body.password);
  if (passwordError) errors.password = passwordError;
  if (!AVATARS.includes(avatar)) errors.avatar = `Avatar must be one of: ${AVATARS.join(', ')}`;

  if (Object.keys(errors).length) throw new AppError('Please fix the highlighted fields', 400, errors);
  return { username, email, password: body.password, avatar };
}

function validateLogin(body = {}) {
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || identifier.length > 254 || !password || password.length > 200) {
    throw new AppError('Enter your username (or email) and password', 400);
  }
  return { identifier, password };
}

module.exports = { validateRegistration, validateLogin, validatePassword, AVATARS };
