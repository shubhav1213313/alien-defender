# Alien Defender: The Last Stand

A browser-based 2D alien survival shooter that combines arcade action with
mathematics puzzles. Built for **CIS046-3 Software for Enterprise**.

> **Status:** in development. Milestone 1 (project foundation) is complete.
> This README is extended as each milestone is finished.

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

More controls are added as gameplay milestones are completed.

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | none | Liveness check → `{ success, status, uptimeSeconds }` |

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
