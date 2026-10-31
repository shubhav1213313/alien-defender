# Alien Defender: The Last Stand

A browser-based 2D alien survival shooter that combines arcade action with
mathematics puzzles. Built for **CIS046-3 Software for Enterprise**.

> **Status:** in development. Complete so far: foundation, combat engine,
> five enemy types, waves/difficulty/scoring, three-phase boss, Knowledge
> Challenge Arena (Banana API), MySQL accounts with saved scores,
> leaderboard and achievements, ZenQuotes as a second API, an admin
> dashboard with role-based access control, and CSRF protection.
> Still to come: audio, touch controls and final polish.

## Roles and the admin dashboard (RBAC)

Two roles: **player** (default for every new account) and **admin**.

- Every `/api/admin/*` route checks the role **on the server, against the
  database, on every request** - never a value sent by the browser or
  cached at login. Guests get **401**, players get **403 Forbidden**.
- Admins see an *Admin Dashboard* button with: player/game/puzzle counts,
  external API status, a user list (promote/demote) and recent scores
  (remove cheated scores from the leaderboard).
- Safety rules: admins cannot change their own role and the last admin
  cannot be demoted.
- There is deliberately **no way to become admin through the website**.
  Create the first admin from the terminal after registering in the game:
  ```powershell
  npm run admin:promote -- your_username
  npm run admin:demote  -- your_username
  ```

## CSRF protection

Every `POST`/`PATCH`/`DELETE` request must send an `X-CSRF-Token` header
matching a random 256-bit token stored in the visitor's server-side session
(synchronizer token pattern; compared in constant time). Another website
cannot read the token, so it cannot forge requests even though the browser
would attach the session cookie. The token is fetched from
`GET /api/csrf-token`, **rotated at login** together with the session id,
discarded at logout, and refreshed automatically by the browser client if
it goes stale. `SameSite=Lax` cookies add a second, independent layer.
Missing or wrong tokens get `403 { code: "CSRF_INVALID" }`.

## Second external API: ZenQuotes

Motivational quotes on the menu, game-over and victory screens come from
[ZenQuotes](https://zenquotes.io/) **via our server** (verified behaviour, 2026-10-31):

- One call to `https://zenquotes.io/api/quotes` returns 50 quotes, which
  are **cached for an hour** and shared by every player - as the ZenQuotes
  docs recommend. Concurrent requests share a single API call.
- The free tier allows **5 requests per 30 s per IP** and sends no CORS
  headers, so the browser could not call it directly anyway.
- When rate limited, ZenQuotes still answers HTTP 200 with a fake quote
  ("Too many requests…"); the service detects this as `RATE_LIMITED`.
- **3 s timeout**; after a failure it waits 60 s before retrying, keeps
  serving the old cache if it has one, and otherwise uses built-in
  fallback quotes labelled "offline quote". Quotes are never requested
  during gameplay, so the API can never slow the game down.
- The required attribution link to https://zenquotes.io/ is shown with
  every ZenQuotes quote.
- The top bar shows the last **measured latency** of both external APIs
  (`GET /api/status`, which reports measurements and never calls the APIs).

## Player accounts (virtual identity)

- **Register / log in** (username or email) from the menu. Guests can still
  play; only logged-in players' games are saved.
- Passwords are hashed with **bcrypt** (cost 12) - never stored in plain text.
- **Server-side sessions stored in MySQL**. The browser only holds a
  random session id in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in
  production). A new session id is issued at login (session fixation).
- **15-minute inactivity timeout** and an **8-hour absolute lifetime**,
  enforced on the server; the player is told why they were logged out.
- **Profile**: games played, high score, aliens destroyed, boss victories,
  quiz accuracy, shot accuracy, best combo, recent games, trophy showcase.
- **Global leaderboard**: each player's best score, filterable by difficulty.
- **10 achievements** unlocked by real events and stored in MySQL: First
  Blood, Alien Hunter, Wave Survivor, Boss Slayer, First Victory, Combo
  Master, Perfect Quiz, Knowledge Master, Hardened Defender, Legendary Defender.

### What the server does not trust

| Value | Source of truth |
|---|---|
| Who the player is | Signed session cookie → MySQL session |
| Play duration | Server timestamps (`game_sessions.started_at`) |
| Arena score | `quiz_attempts`, written by the server when rewards are claimed |
| Score, kills, combo… | Sent by the browser → type/range checks + plausibility checks against server-measured time (`422` if impossible) |
| Duplicate submissions | `finished_at IS NULL` condition inside a transaction (`409`) |

**Limitation:** the game simulation runs in the browser, so a determined
player could still submit forged but *plausible* numbers. Preventing that
completely would require running the game on the server. The checks above
reject malformed and physically impossible results and make cheating harder,
not impossible.

## Gameplay so far

- Five waves of increasing size and variety, each introduced by a banner.
- Five alien types: **Scout** (fast weaver), **Zigzag Raider** (erratic),
  **Armored Alien** (tough, 3-way spread), **Sniper** (telegraphed aimed
  shots), **Kamikaze** (locks on and dives).
- **Easy / Normal / Hard** change enemy speed, health, fire rate, bullet
  speed, damage taken, spawn rate, Earth shield and score multiplier.
- Hull + shield for the player; an **Earth shield** that drops when aliens
  slip past. Either reaching zero ends the game.
- Combo multiplier (x1.5 every 5 rapid kills, max x4) and wave-clear bonuses.
- **Mothership boss** after wave 5 with three health-based phases
  (fans/aimed shots → spreads + escorts → spiral + bullet curtains with a
  guaranteed safe gap).

## Knowledge Challenge Arena (Banana API)

After **every wave** the game pauses and the arena opens automatically. It
cannot be skipped, but it never blocks progress: once all four questions
have been attempted, the next wave starts whatever the score.

1. Choose puzzle difficulty (Easy / Normal / Hard).
2. Solve **four** real puzzles from Marc Conrad's Banana API.
3. One scored answer per puzzle; wrong answers reveal the solution.
4. Rewards are calculated **on the server** and applied once.

**Honesty note:** the Banana API has no difficulty parameter (verified:
only `out` and `base64` exist), so every mode gets the same kind of puzzle.
Difficulty is game-side and shown to the player:

| Mode | Time per puzzle | Hints | Perfect (4/4) reward |
|---|---|---|---|
| Easy | 60 s | 1 per puzzle (parity + range) | Standard ability, +30 energy |
| Normal | 35 s | none | **Enhanced** ability (+50% duration/power, −25% cost), +35 energy |
| Hard | 20 s | none | **Elite** ability, +40 energy |

Reward tiers (cumulative): **0/4** nothing (continue normally) · **1/4** +10
energy · **2/4** +20 energy & +15 hull · **3/4** + standard ability ·
**4/4** stronger ability by difficulty (+25 hull).

| After wave | Standard ability (key) | Hard-perfect elite ability |
|---|---|---|
| 1 | Mini Shield (1) | Ghost Mode – immune for 5 s |
| 2 | Rapid Fire (2) | Phantom Overdrive – invisible, invulnerable, rapid fire |
| 3 | Triple Laser (3) | Time Freeze + Triple Laser |
| 4 | EMP Blast (4) | Ultimate Nova |
| Boss | Victory bonus: points + energy; leftover energy → score; perfect Hard = **Legendary Defender** | |

Abilities cost Knowledge Energy, have cooldowns, stay unlocked for the
rest of the game and are only ever upgraded. The full game is winnable
with **no** abilities (verified by an automated full-game test at 0/4).

**Resilience:** 4 s timeout on Banana API calls; on timeout, network
error, HTTP error or an invalid response the server serves a clearly
labelled **OFFLINE PUZZLE** instead. If the game server itself is
unreachable, the arena offers *Try again* or *Continue without rewards*.

## Technology stack

| Layer | Technology |
|---|---|
| Presentation | HTML5, CSS3, vanilla JavaScript (ES modules), HTML5 Canvas |
| Business logic | Node.js, Express.js (REST + JSON) |
| Data access | MySQL 8, `mysql2/promise` connection pool, repository classes, SQL migrations |
| Security | Helmet, bcrypt, express-session + MySQL store, RBAC, CSRF, rate limiting |
| Testing | Jest, Supertest, babel-jest (lets Jest import the browser ES modules) |

## Folder structure

```
alienn-defender/
├── public/              # Presentation layer – the ONLY folder served to browsers
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── main.js      # Browser entry point (wires engine + UI)
│       ├── api/         # fetch wrapper for the REST API
│       ├── game/        # Game engine modules (ES modules, unit tested in Jest)
│       └── ui/          # Arena, account, profile, leaderboard, score saving
├── src/                 # Business logic layer (never served statically)
│   ├── config/          # Environment configuration
│   ├── db/pool.js       # The single shared MySQL connection pool
│   ├── routes/          # Express routes
│   ├── controllers/     # Request/response handling
│   ├── services/        # Business rules (auth, scores, arena, Banana API)
│   ├── repositories/    # Data access layer (SQL lives here only)
│   ├── validation/      # Input validation rules
│   ├── middleware/      # Sessions, auth, error handling
│   ├── app.js           # Builds the Express app (dependencies injectable for tests)
│   └── server.js        # Checks MySQL, starts the HTTP listener
├── database/migrations/ # SQL schema, applied by scripts/migrate.js
├── scripts/migrate.js   # npm run db:migrate
├── tests/
│   ├── unit/            # Game logic, rules, UI (jsdom) tests
│   ├── integration/     # HTTP/API tests with Supertest (in-memory DB)
│   ├── db/              # REAL MySQL tests (npm run test:db)
│   ├── live/            # REAL Banana API tests (npm run test:live)
│   └── helpers/         # In-memory repositories, test app factory
└── docs/                # Architecture, demo and viva notes
```

## Getting started (Windows + VS Code)

1. Install [Node.js 20+](https://nodejs.org/) and MySQL 8.
2. Open the `alienn-defender` folder in VS Code and open a terminal
   (**Terminal → New Terminal**, PowerShell).
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Copy `.env.example` to `.env` and fill in your own values (at least
   `DB_PASSWORD` and a random `SESSION_SECRET`). `.env` is git-ignored and
   must never be committed.
5. Make sure the **MySQL80** Windows service is running (`services.msc`).
6. Create the database and tables:
   ```powershell
   npm run db:migrate
   ```
   This creates `DB_NAME` if needed and applies each file in
   `database/migrations` once (tracked in `schema_migrations`), including
   the 10 achievement definitions. Running it again is safe.
7. Run the tests: `npm test`
8. Start the server: `npm start`, then open <http://localhost:3000>.
   The console prints `MySQL connected (...)` - or a hint if the
   password/database is wrong.

### Database tables

`users` · `game_sessions` (one per game started) · `scores` (one result
per session) · `quiz_attempts` (arena results) · `achievements` (catalogue)
· `user_achievements` · `sessions` (login sessions) · `schema_migrations`.
Foreign keys use `ON DELETE CASCADE`, so deleting a user removes their
games, scores, quiz attempts and trophies.

## Controls

| Key | Action |
|---|---|
| W A S D / Arrow keys | Move |
| Space | Shoot (hold) |
| 1 2 3 4 | Activate unlocked abilities |
| P / Esc | Pause / resume (not available inside the arena) |
| Enter | Start a game; submit a puzzle answer in the arena |

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | none | Liveness + database check → `{ status, database: "ok"/"unavailable" }` |
| GET | `/api/csrf-token` | none | `{ csrfToken }` for the `X-CSRF-Token` header (all POST/PATCH/DELETE need it) |
| GET | `/api/admin/overview` | **admin** | Counts + external API status (401 guest, 403 player) |
| GET | `/api/admin/users` | **admin** | Users with games played and best score |
| PATCH | `/api/admin/users/:id/role` | **admin** | `{ role: "player" \| "admin" }`; not your own role; not the last admin |
| GET | `/api/admin/scores` | **admin** | 20 most recent scores |
| DELETE | `/api/admin/scores/:id` | **admin** | Remove a score from the leaderboard |
| POST | `/api/auth/register` | none | `{ username, email, password, avatar? }` → 201 + logged in; 400 field errors; 409 duplicate (10/hour) |
| POST | `/api/auth/login` | none | `{ identifier, password }` (username or email) → 200; 401 generic error (10 failures/15 min) |
| POST | `/api/auth/logout` | none | Destroys the session |
| GET | `/api/auth/me` | none | `{ user }` or `{ user: null }` - restores identity after reload |
| POST | `/api/games` | **login** | `{ difficulty }` → `{ gameSessionId }` |
| POST | `/api/games/:id/result` | **login** | Final game summary → saved score, personal best, new achievements (400 / 404 / 409 / 422) |
| GET | `/api/profile` | **login** | Stats, recent games, achievements with unlock dates |
| GET | `/api/leaderboard` | none | `?difficulty=all\|easy\|normal\|hard&limit=1-50` best score per player |
| GET | `/api/achievements` | none | Achievement catalogue |
| GET | `/api/quotes/random` | none | `?context=menu\|gameover\|victory` → `{ quote, author, source: "zenquotes"\|"fallback", stale, attribution }` |
| GET | `/api/status` | none | Last measured status/latency of the Banana and ZenQuotes APIs |
| GET | `/api/challenges/rules?wave=N` | none | Difficulty rules, reward table, abilities on offer |
| POST | `/api/challenges` | none* | `{ wave, difficulty, gameSessionId? }` → new arena (rate limited: 20/min) |
| GET | `/api/challenges/:id` | none* | Arena progress |
| GET | `/api/challenges/:id/question` | none* | Current puzzle image, source, latency (never the solution) |
| POST | `/api/challenges/:id/answer` | none* | `{ questionIndex, answer }` → correct?, solution revealed; 409 on duplicates |
| POST | `/api/challenges/:id/hint` | none* | Easy only, once per puzzle (403 otherwise) |
| POST | `/api/challenges/:id/claim` | none* | Server-calculated rewards, once per arena (409 on repeat) |

\* Arenas are identified by an unguessable random id and kept in server
memory for 30 minutes. A logged-in player's arena is visible only to that
player (others get 404), and its result is written to `quiz_attempts`.
`401` responses carry `code: "AUTH_REQUIRED"` or `"SESSION_EXPIRED"`;
`403` responses carry `code: "FORBIDDEN"` (role) or `"CSRF_INVALID"`.

## Tests

```powershell
npm test            # unit + integration tests: no network, no database needed
npm run test:db     # REAL MySQL: migrations, repositories, MySQL session store
                    #   (uses .env credentials; recreates alien_defender_test)
npm run test:live   # REAL Banana API (needs internet)
```

Unknown `/api/*` routes return `404 { "success": false, "error": "Not found" }`.

## Troubleshooting

**Registration says "server problem" / "username or email already
registered", or the game looks different from expected.** Check that
http://localhost:3000 is really *this* project: open
<http://localhost:3000/api/health> - it must show `"app":"alienn-defender"`.
If it does not, another server (for example an older copy of the game in a
different folder) is using port 3000. `npm start` now refuses to start in
that case and prints `ERROR: port 3000 is already in use ...`. Stop the
other server (Ctrl+C in its terminal, or end its `node.exe` in Task
Manager), or set a different `PORT` in `.env`.

**`npm start` says it cannot connect to MySQL.** Check the MySQL80 service
is running and `DB_USER` / `DB_PASSWORD` in `.env`; run `npm run db:migrate`
if the database does not exist yet.

## Security notes

- Helmet sets security headers including a Content Security Policy that
  only allows scripts from the site itself.
- Only `public/` is served statically; tests confirm `src/`, `.env`,
  `package.json` and `database/` cannot be downloaded.
- All SQL uses `?` placeholders (parameterised queries); a real-MySQL test
  confirms `' OR '1'='1` style input is treated as plain text.
- Login and registration are rate limited; login errors never reveal
  whether a username exists.
- Server data shown in the page is inserted as text, never as HTML.
- `npm audit --omit=dev` reports 0 vulnerabilities. An npm `overrides` entry
  forces `express-mysql-session` to use the patched top-level `mysql2`
  instead of its bundled older copy.

## AI assistance disclosure

This project was developed with assistance from an AI coding assistant
(Anthropic Claude, via Claude Code in VS Code). The AI helped with scaffolding,
code generation, test writing and documentation under the student's direction.
The student reviewed, ran and is responsible for all submitted code, and can
explain its design and behaviour. AI use is disclosed here, in line with the
university's AI-use policy, rather than in individual commit messages.
