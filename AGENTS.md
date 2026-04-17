# AGENTS

## Agent execution rule
- 每次执行完命令后，使用中文提交一次 Git commit，message 为本次改动的简写。

## First Read (highest signal)
- `README.md` (run modes + container entrypoint)
- `Makefile` (canonical dev/prod commands)
- `docker-compose.dev.yml` + `deploy/nginx/nginx.dev.conf` (real request routing in dev)
- `server/internal/bootstrap/app.go` + `server/internal/handler/router.go` (backend wiring and route registration)
- `docs/workflow-dsl/README-AI.md` + `docs/workflow-runtime/README.md` (workflow DSL/runtime constraints used by code)

## How to run correctly
- Preferred: run via gateway on `http://localhost:325` (`make dev`), not direct `5173`, because `/api/*` is routed by nginx to backend.
- Dev stack: `make dev` (build backend image + `docker compose -f docker-compose.dev.yml up --build`).
- Stop everything: `make down`.
- Logs: `make logs`.

## Verification commands
- Backend tests (inside container): `docker compose -f docker-compose.dev.yml exec backend go test ./...`
- Single backend test: `docker compose -f docker-compose.dev.yml exec backend go test ./internal/workflowruntime -run TestName`
- Frontend lint (inside container): `docker compose -f docker-compose.dev.yml exec frontend npm run lint`
- Note: local host may not have `go`/`next`; repo is set up to run tooling in containers.

## Architecture map (actual entrypoints)
- Backend process entry: `server/cmd/api/main.go` -> `server/internal/bootstrap/app.go`.
- All API routes mounted under `/api` in backend (`server/internal/bootstrap/app.go`, `server/internal/handler/router.go`).
- Frontend app router lives in `web/app`; console shell is `web/app/(console)/layout.tsx` + `web/components/layout/AppShell.tsx`.
- Workflow editor core is under `web/components/workflow/dify/*` (types/config/validation/store).

## Repo-specific gotchas
- Backend storage mode is env-sensitive:
  - `DATABASE_URL` unset: app degrades to in-memory repositories.
  - `DATABASE_URL` set but DB unavailable: app panics on startup (intentional fail-fast).
- Schema/migrations are code-driven in `server/internal/db/migrate.go` (no external migration tool).
- Dev compose mounts Postgres data to an absolute host path (`/Users/logan/Documents/code/pgsql`); adjust on non-macOS hosts if needed.
- Workflow execution API supports SSE at `/api/workflow/executions/:id/stream`; nginx has explicit no-buffer config for this path.

## Auth and seeded defaults (dev)
- Login API: backend `POST /api/auth/login`.
- Seeded users come from `server/internal/db/migrate.go`: `developer/123456` (admin), `normal-user/123456` (user).
- Protected APIs require `Authorization: Bearer <token>` (see `server/internal/middleware/auth_middleware.go`).

## Frontend API proxy caveat
- `web/app/api/*` contains Next proxy handlers, but in normal docker dev (`:325`) nginx sends `/api/*` directly to backend, bypassing those handlers.
- Do not assume every backend endpoint has a matching `web/app/api/.../route.ts`; several UI calls rely on gateway direct proxying.
