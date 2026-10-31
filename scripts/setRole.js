// Grants or removes the admin role from the command line. This is how the
// FIRST admin is created - there is deliberately no way to become admin
// through the website itself.
//
//   npm run admin:promote -- <username>
//   npm run admin:demote  -- <username>
require('dotenv').config({ quiet: true });
const { getPool, closePool } = require('../src/db/pool');

async function setRole(username, role) {
  if (!username) throw new Error('Usage: npm run admin:promote -- <username>');
  const [result] = await getPool().execute('UPDATE users SET role = ? WHERE username = ?', [role, username]);
  if (result.affectedRows !== 1) throw new Error(`No user called "${username}" (register in the game first)`);
  return `${username} is now ${role === 'admin' ? 'an admin' : 'a player'}.`;
}

if (require.main === module) {
  const [role, username] = process.argv.slice(2);
  setRole(username, role)
    .then((message) => console.log(message))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => closePool());
}

module.exports = { setRole };
