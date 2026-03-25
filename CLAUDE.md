# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

```bash
npm install          # Install dependencies
node server.js       # Start server on PORT (default 3000)
```

No build step, no test framework. All frontend is vanilla HTML/CSS/JS served statically.

## Architecture

Real-time Q&A platform for meetups. Three interfaces, one codebase:

- **Landing page** (`/` → `public/index.html`) — Create sessions, get audience + speaker links
- **Audience page** (`/s/:slug` → `public/audience.html`) — Ask questions, upvote, swipe-to-edit/delete own questions
- **Speaker page** (`/s/:slug/speaker` → `public/speaker.html`) — Manage questions, focus for projector, QR code for audience

### Data flow

```
Browser ←→ Socket.io ←→ Express (server.js) ←→ Turso/libSQL (db.js)
```

All state changes go through Socket.io events. After any mutation, `broadcastQuestions()` queries once with `getAllQuestions` and filters in JS, then emits `questions-updated` to the entire slug room with both `questions` (audience-visible) and `allQuestions` (speaker-visible).

### Key files

| File | Role |
|------|------|
| `server.js` | Express routes + all Socket.io event handlers |
| `db.js` | Turso/libSQL schema, indexes, migrations, async prepared statements |
| `nicknames.js` | Norwegian adjective+animal nickname generator |
| `profanity.js` | bad-words filter with Norwegian additions |
| `public/js/audience.js` | Audience client: questions, voting, swipe gestures, inline edit |
| `public/js/speaker.js` | Speaker client: filters, focus overlay, typewriter, QR, tab badge |
| `public/js/version.js` | Single source for APP_VERSION (bump before each deploy) |
| `public/js/particles.js` | Floating background animation |
| `public/css/style.css` | All styling, dark theme via CSS variables |

## Database

Turso hosted SQLite via `@libsql/client`. Four tables: `sessions`, `questions`, `votes`, `counters`. Schema defined in `db.js` with `CREATE TABLE IF NOT EXISTS`, initialized via async `initDb()`.

**Environment variables:** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (set in Render). Falls back to local `file:tkai.db` without env vars.

**All db calls are async** — `stmts` object wraps queries with `makeRun`/`makeGet`/`makeAll` helpers that return promises. Socket.io and Express handlers use `async/await` with try/catch.

**Migrations** use try/catch ALTER TABLE pattern:
```javascript
try { await client.execute('ALTER TABLE questions ADD COLUMN visitor_id TEXT'); } catch (e) {}
```

Sessions auto-delete after 24 hours.

## Authorization Model

No login. Browser generates `visitor_id` (stored in localStorage), sent with socket events. Questions store `visitor_id` for ownership — edit/delete checks compare against it server-side. Speaker actions (focus/answer/hide/delete) have no auth beyond knowing the `/speaker` URL.

## Important Patterns

- **All UI text is Norwegian** — error messages, labels, button text, nicknames
- **crypto.randomUUID fallback** — `audience.js` falls back to Math.random-based ID on HTTP (non-HTTPS contexts lack crypto.randomUUID)
- **Speaker images** — resized to 256x256 client-side, stored as base64 JPEG in SQLite
- **Slug generation** — title transliterated (æ→ae, ø→o, å→aa) + UUID suffix, retries up to 5 times on collision
- **Vote reset on edit** — editing a question zeros its upvotes and deletes all vote records
- **Swipe gestures** — touch-only, dampened at 0.55x, 100px threshold, spring snap-back via CSS cubic-bezier
- **Session persistence** — landing page stores last session in localStorage so links survive page reload

## CSS Theme

Dark theme with Space Grotesk font. Key variables in `:root`:
- `--bg: #040308`, `--surface: #0e0c14`, `--accent: #6c5ce7`, `--accent-light: #a29bfe`
- `--success: #00b894`, `--danger: #e17055`, `--warning: #fdcb6e`

## Deployment

Hosted on Render.com (auto-deploys from GitHub `main` branch). No Dockerfile — Render uses native Node.js buildpack. Bump `APP_VERSION` in `public/js/version.js` before each deploy.

**Turso database:** `tkai-qa` under org `superponni` (aws-eu-west-1). Manage via `turso` CLI or Turso dashboard.

GitHub repo: https://github.com/Ninjaponni/tkai-qa
