# Alien Defender: The Last Stand

A browser-based 2D alien survival shooter that combines arcade action with
mathematics puzzles. Built for **CIS046-3 Software for Enterprise**.

> **Status:** in development. Complete so far: foundation, combat engine,
> five enemy types, waves/difficulty/scoring, three-phase boss, and the
> Knowledge Challenge Arena (Banana API). Authentication, database,
> leaderboard and achievements persistence are still to come.

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
| Data access | MySQL, `mysql2/promise` (added in the database milestone) |
| Security | Helmet, bcrypt, express-session + MySQL store, RBAC, CSRF, rate limiting |
| Testing | Jest, Supertest, babel-jest (lets Jest import the browser ES modules) |

## Folder structure

```
alienn-defender/
├── public/              # Presentation layer – the ONLY folder served to browsers
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── main.js      # Browser entry point
│       └── game/        # Game engine modules (ES modules, unit tested in Jest)
├── src/                 # Business logic layer (never served statically)
│   ├── config/          # Environment configuration
│   ├── routes/          # Express routes
│   ├── controllers/     # Request/response handling
│   ├── services/        # Business rules, external API clients
│   ├── repositories/    # Data access layer (SQL lives here only)
│   ├── middleware/      # Error handling, auth, CSRF
│   ├── app.js           # Builds the Express app (imported by tests)
│   └── server.js        # Starts the HTTP listener
├── database/            # Migrations and seed data
├── tests/
│   ├── unit/            # Game logic tests
│   └── integration/     # HTTP/API tests with Supertest
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
4. Copy `.env.example` to `.env` and fill in your own values. `.env` is
   git-ignored and must never be committed.
5. Run the tests: `npm test`
6. Start the server: `npm start`, then open <http://localhost:3000>.

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
| GET | `/api/health` | none | Liveness check → `{ success, status, uptimeSeconds }` |
| GET | `/api/challenges/rules?wave=N` | none | Difficulty rules, reward table, abilities on offer |
| POST | `/api/challenges` | none* | `{ wave, difficulty }` → new arena (rate limited: 20/min) |
| GET | `/api/challenges/:id` | none* | Arena progress |
| GET | `/api/challenges/:id/question` | none* | Current puzzle image, source, latency (never the solution) |
| POST | `/api/challenges/:id/answer` | none* | `{ questionIndex, answer }` → correct?, solution revealed; 409 on duplicates |
| POST | `/api/challenges/:id/hint` | none* | Easy only, once per puzzle (403 otherwise) |
| POST | `/api/challenges/:id/claim` | none* | Server-calculated rewards, once per arena (409 on repeat) |

\* Arenas are identified by an unguessable random id and stored in server
memory for 30 minutes. They will be tied to the logged-in user once
authentication is added.

## Tests

```powershell
npm test            # all unit + integration tests (external APIs are mocked, no network needed)
npm run test:live   # LIVE check against the real Banana API (needs internet)
```

Unknown `/api/*` routes return `404 { "success": false, "error": "Not found" }`.

## Security notes

- Helmet sets security headers including a Content Security Policy that
  only allows scripts from the site itself.
- Only `public/` is served statically; tests confirm `src/`, `.env`,
  `package.json` and `database/` cannot be downloaded.
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
