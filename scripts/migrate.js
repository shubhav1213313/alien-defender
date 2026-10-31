// Creates the database (if needed) and applies every SQL file in
// database/migrations exactly once, in filename order. Applied migrations
// are recorded in the schema_migrations table.
//
//   npm run db:migrate                  uses DB_* settings from .env
//   DB_NAME=alien_defender_test npm run db:migrate   (e.g. a test database)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config/env');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');
const SAFE_DB_NAME = /^[A-Za-z0-9_]+$/;

async function migrate({ database = config.db.database, log = console.log } = {}) {
  if (!SAFE_DB_NAME.test(database)) throw new Error(`Unsafe database name: ${database}`);

  // multipleStatements is enabled ONLY for this trusted migration script,
  // never for the application pool.
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${database}\``);
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

    const [rows] = await connection.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`Applying ${file}...`);
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      count += 1;
    }
    log(count ? `Applied ${count} migration(s) to ${database}.` : `${database} is already up to date.`);
    return count;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error(`Migration failed: ${err.code || ''} ${err.message}`);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('Check DB_USER and DB_PASSWORD in your .env file.');
    if (err.code === 'ECONNREFUSED') console.error('Is the MySQL80 service running? (services.msc)');
    process.exit(1);
  });
}

module.exports = { migrate };
