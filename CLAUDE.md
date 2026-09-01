# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Claude Review Role

`AGENTS.md` is the source of truth for project requirements and development rules.

Claude should primarily review and validate changes implemented by Codex. Reviews should:

- Identify functional regressions, security issues, data-loss risks, and unnecessary complexity.
- Check every change for consistency with `AGENTS.md`.
- Pay special attention to mobile usability.
- Pay special attention to PostgreSQL persistence and the ephemeral nature of container filesystems.
- Verify that no secrets or real credentials are committed.
- Verify that no unnecessary framework, ORM, build system, or abstraction has been introduced.
- Avoid modifying code unless explicitly requested.
- Clearly distinguish confirmed findings from assumptions.
- Remain concise and actionable.

## Project state

This codebase is an early-stage scaffold, not a feature-complete app. Currently implemented: an Express server that serves a static placeholder page and a `/health` endpoint that pings PostgreSQL. None of the V1 functional scope in `AGENTS.md` (students, classes, sessions, attendance, QR codes, exports) has been built yet — there is no database schema/migrations, no routes beyond `/` and `/health`, and no authentication. Expect most review work to be against future diffs that add this functionality incrementally.

## Commands

- `npm start` — run the server (`src/server.js`) on `$PORT` (default 3000).
- `npm run dev` — run the server with Node's `--watch` for auto-restart on file changes.
- `docker compose up` — run the app plus a local PostgreSQL 17 container together (reads `.env`; copy `.env.example` to `.env` first).
- `curl localhost:3000/health` — verify the app can reach PostgreSQL.

There is no test suite, linter, or build step configured yet (no `test`/`lint`/`build` scripts in `package.json`).

## Architecture

- **Runtime**: Node.js (>=22) + Express 5, single process, no framework beyond Express (per `AGENTS.md`, no frontend framework and no ORM).
- **Entry point**: `src/server.js` — configures Express, validates `PORT`, serves `public/` as static assets, serves `views/index.html` for `/`, and exposes `/health`. It calls `verifyDatabaseConnection()` before binding to the port and exits (`process.exit(1)`) if PostgreSQL is unreachable at startup — the app is designed to fail fast rather than serve without a working database.
- **Database**: `src/db/client.js` creates a single `pg` `Pool` from `DATABASE_URL` (required — throws if missing). `DATABASE_SSL=true` enables TLS with certificate verification; otherwise SSL is disabled (used for local/docker-compose Postgres). PostgreSQL is the *only* persistent store — the container filesystem is ephemeral (Lightsail Container Service), so nothing written to disk in the container survives a redeploy.
- **Frontend**: Plain HTML/CSS/JS served from `views/` and `public/` — no build step, no bundler, no client-side framework. UI text is French; code/comments/commits are English (per `AGENTS.md`).
- **Deployment**: `Dockerfile` builds a production image (`npm ci --omit=dev`, runs as non-root `node` user, listens on port 3000 over plain HTTP — TLS termination happens at Lightsail, not in the container). `docker-compose.yml` is for local development only and pairs the app with a `postgres:17-alpine` container plus a named volume for data persistence between local runs.
- **Configuration**: All config is via environment variables loaded through `dotenv` (`.env`, not committed — see `.env.example` for the required keys: `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`).

See `AGENTS.md` for the full functional specification (V1 scope, workflows, UI rules) and development rules — it is the source of truth and takes precedence over assumptions made from the current (minimal) code.
