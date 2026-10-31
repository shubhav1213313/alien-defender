# Alien Defender: The Last Stand

A browser-based 2D alien survival shooter that combines arcade action with
mathematics puzzles. Built for **CIS046-3 Software for Enterprise**.

> **Status:** in development. Complete so far: foundation, combat engine,
> five enemy types, waves/difficulty/scoring, three-phase boss, Knowledge
> Challenges (Banana API, compulsory 2-puzzle quiz after each wave + optional VOID STORM puzzle), MySQL accounts with saved scores,
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
- **11 achievements** unlocked by real events and stored in MySQL: First
  Blood, Alien Hunter, Wave Survivor, Boss Slayer, First Victory, Combo
  Master, Perfect Quiz, Knowledge Master, Hardened Defender, Legendary Defender, Storm Caller.

### What the server does not trust

| Value | Source of truth |
|---|---|
| Who the player is | Signed session cookie → MySQL session |
| Play duration | Server timestamps (`game_sessions.started_at`) |
| Quiz score | `quiz_attempts`, written by the server when rewards are claimed |
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

## Look and feel

Neon sci-fi interface (`public/css/theme.css`): Orbitron and Rajdhani
fonts (Google Fonts, falling back to Segoe UI offline), an animated CSS
starfield behind the page, glass panels, glowing gradient buttons and a
gradient logo. In the game canvas: nebulae and twinkling parallax stars, a
curved **Earth horizon** with continents and drifting clouds
(`public/js/game/EarthRenderer.js`), and Earth's energy-shield arc - cyan
when healthy, red when low, flickering whenever an alien gets through. A
pulsing red vignette warns when the hull is low. Animations respect the
"reduce motion" accessibility setting.

## Knowledge Challenges (Banana API)

There is **no Upgrade Bay** in this game. Between waves the only screen
is the compulsory Banana quiz.

**Compulsory quiz after waves 1, 2, 3 and 4.** The moment the last alien
of a wave is gone, enemy spawning and combat stop and the quiz opens
automatically. It cannot be skipped (pause, Enter and ability keys do
nothing), but it never blocks progress:

1. Instructions and the reward preview, e.g. **"SOLVE BOTH PUZZLES TO
   UNLOCK PLASMA SHIELD"**.
2. **Two** genuine Marc Conrad Banana API image puzzles, shown unmodified:
   - **Waves 1–3: fixed cached puzzles.** Six genuine puzzles (two per
     wave, IDs `W1-Q1` … `W3-Q2`) were fetched once from the live API by
     [scripts/cacheFixedPuzzles.js](scripts/cacheFixedPuzzles.js) and saved
     with the API's own solution, fetch time and SHA-256 in
     `data/banana-fixed/` (outside `public/`, so never served). The same
     puzzles appear in the same order every game, labelled *"Banana API
     puzzle · cached"* - the game never claims they are live. The server
     refuses to start a quiz with an image that no longer matches its
     recorded hash.
   - **Wave 4: two live Banana API puzzles**, fetched fresh each game
     (*"Live Banana API · N ms"*). If the API repeats a puzzle within the
     quiz, the server fetches another one.
3. Answer with the **0–9 buttons** (or number keys); one answer per
   puzzle, checked on the server, 45 s each, one honest hint per puzzle (parity and range - never
   the answer). Wrong answers show the solution.
4. **2/2** unlocks that wave's ability; **0/2 or 1/2** unlocks nothing.
   Either way the next wave starts.

| After wave | Ability (key) | Effect | Energy | Cooldown |
|---|---|---|---|---|
| 1 | **Plasma Shield** (1) | 6 s barrier: no damage, enemy bullets touching it are destroyed | 20 | 18 s |
| 2 | **Hyper Blaster** (2) | 8 s: 2.5x fire rate and double damage | 25 | 16 s |
| 3 | **Triple Beam** (3) | 10 s: every shot splits into three | 25 | 16 s |
| 4 | **EMP Shockwave** (4) | Clears enemy bullets, 4 damage to all aliens (15 to the boss), 2 s stun | 35 | 22 s |
| special | **VOID STORM** (5) | 6 s lightning: up to 3 aliens struck every 0.4 s (3 damage; 2 to the boss) | 50 | 40 s |

Each correct answer gives **+15 Knowledge Energy** (+30 for the special
puzzle), which abilities spend. The HUD shows every slot with its key,
cost (red if unaffordable), cooldown and remaining effect time.

**Optional special puzzle.** Sometimes during a normal wave a small
right-side notice appears: *"⚡ SPECIAL PUZZLE AVAILABLE! Solve one hard
puzzle to unlock VOID STORM!"*. It is clickable for **4 seconds** (with a
countdown); ignoring it changes nothing. Clicking pauses combat for **one**
Banana puzzle (20 s, no hint); correct unlocks VOID STORM, otherwise you go
straight back to the same wave. At most one invitation per wave, none
during the boss fight, never again once VOID STORM is owned, and an open
invitation is withdrawn when the wave ends - it can never replace the
compulsory quiz. VOID STORM cannot kill the boss on its own (a full storm
deals well under 20% of its health; verified by a test).

**After the boss:** the *Victory Bonus Challenge* (two puzzles for bonus
points; 2/2 on a Hard game earns **Legendary Defender**), then the victory
screen. Leftover Knowledge Energy is converted into points.

**Honesty notes:** the Banana API has no difficulty parameter (verified:
only `out` and `base64` exist) - the special puzzle is "hard" only because
of the shorter time and no hint, and the screen says so. There are **no
fabricated puzzles**: if the Banana API times out (4 s) or fails, the
server answers `503 PUZZLE_API_UNAVAILABLE` and the screen offers
**Retry** or **Continue without ability**, so the game can never get stuck.
The whole game is winnable with no abilities at all (automated full-game
test answering 0/2 every time).

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
per session) · `quiz_attempts` (quiz results, with kind wave/bonus/special) · `achievements` (catalogue)
· `user_achievements` · `sessions` (login sessions) · `schema_migrations`.
Foreign keys use `ON DELETE CASCADE`, so deleting a user removes their
games, scores, quiz attempts and trophies.

## Controls

| Key | Action |
|---|---|
| W A S D / Arrow keys | Move |
| Space | Shoot (hold) |
| 1 2 3 4 5 | Activate unlocked abilities (5 = VOID STORM) |
| 0–9 | Answer the puzzle on screen |
| Mouse click | Accept the "SPECIAL PUZZLE AVAILABLE" invitation (4 s) |
| P / Esc | Pause / resume (not available during a quiz) |
| Enter | Start a game from the menu or end screens |

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
| GET | `/api/challenges/rules?kind=K&wave=N` | none | `kind` = `wave` (waves 1-4), `bonus` (5) or `special`: puzzle count, time, hint rule, reward preview |
| POST | `/api/challenges` | none* | `{ kind, wave, difficulty?, gameSessionId? }` → new challenge (rate limited: 20/min) |
| GET | `/api/challenges/:id` | none* | Challenge progress |
| GET | `/api/challenges/:id/question` | none* | Current genuine Banana puzzle image (cached for waves 1–3, live with latency otherwise; never the solution); `503 PUZZLE_API_UNAVAILABLE` if the API is down |
| POST | `/api/challenges/:id/answer` | none* | `{ questionIndex, answer }` → correct?, solution revealed; 409 on duplicates |
| POST | `/api/challenges/:id/hint` | none* | Once per puzzle; 403 on the special puzzle |
| POST | `/api/challenges/:id/claim` | none* | Server-calculated rewards, once per challenge (409 on repeat) |

\* Arenas are identified by an unguessable random id and kept in server
memory for 30 minutes. A logged-in player's challenge is visible only to that
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

**You see an "Upgrade Bay", a "Knowledge Terminal" or a "Puzzle (Q)"
button.** None of these exist in this project - you are looking at an
older, different copy of the game (for example the `alien defender`
folder) that is still running on the same port. Stop it and start this
project with `npm start`; `/api/health` must show `"app":"alienn-defender"`.

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
