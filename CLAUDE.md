# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development - runs API (port 3001) and Web (port 3000) in parallel
pnpm dev

# Build all packages
pnpm build

# Database migrations
pnpm db:migrate

# Type checking (no built-in script, run manually)
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json

# Run individual apps
pnpm --filter @til-stack/api dev
pnpm --filter @til-stack/web dev

# Rebuild shared package after changes
pnpm --filter @til-stack/shared build
```

## Architecture

> **상세 문서**: 전체 아키텍처 분석은 [ARCHITECTURE.md](./ARCHITECTURE.md) 참조

This is a **pnpm monorepo** with three workspaces:

### `apps/api` - Backend API
- **Hono** server with **tRPC** for type-safe API
- **SQLite** database via **better-sqlite3** with **Drizzle ORM**
- Entry point: `src/index.ts`
- tRPC routers:
  - `src/routes/entries.ts`: `upsert`, `list`, `getByDate`, `getByDateRange`, `delete`, `getWeeklySummary`, `getMonthlySummary`
  - `src/routes/config.ts`: `getSkipDays`, `addSkipWeekday`, `addSkipDate`, `removeSkipDay`, `getTemplates`, `getDefaultTemplate`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `setDefaultTemplate`
  - `src/routes/webhooks.ts`: `list`, `create`, `update`, `delete`, `test`
- Webhook scheduler: `src/lib/webhook-scheduler.ts` (node-cron based job management)
- Database schema: `src/db/schema.ts` (tables: `entries`, `skip_days`, `templates`, `webhooks`)

### `apps/web` - Frontend
- **React 19** with **Rspack** bundler
- **TanStack Router** for file-based routing (`src/routes/`)
- **TanStack Query** + **tRPC React** for data fetching with optimistic updates
- **Tailwind CSS** for styling
- **SharedWorker** for local-first offline database (`src/shared-worker.ts`) with minimal service worker for background sync
- Routes:
  - `/` - Daily editor + entry list with infinite scroll
  - `/monthly` - Calendar view with weekly summaries
  - `/config` - Settings (theme, AI, skip days, templates, webhooks)
  - `/login` - Google OAuth login
  - `/auth/callback` - OAuth callback with data migration
- tRPC client setup: `src/lib/trpc.ts`
- AI summarizers: `src/lib/summarizer.ts` (unified hook), with backends in `gemini-summarizer.ts`, `webllm-summarizer.ts`, `groq-summarizer.ts`, `google-ai-summarizer.ts`
- Local database: `src/worker/persistence.ts` (IndexedDB for sql.js persistence)

### `packages/shared` - Shared Code
- Zod schemas for API validation (`src/validators.ts`)
- TypeScript interfaces (`src/types.ts`)
- **Must rebuild after changes**: `pnpm --filter @til-stack/shared build`

## Data Flow

1. Web app imports types from `@til-stack/api/routes` (via package exports)
2. Shared validators are used by both API (input validation) and can be used by web
3. tRPC provides end-to-end type safety from API to frontend

## Key Patterns

- **One entry per day**: Entries are keyed by date (YYYY-MM-DD format)
- **Upsert pattern**: `entries.upsert` creates or updates based on date
- **Optimistic updates**: Mutations update cache immediately, rollback on error
- **Infinite scroll**: `entries.list` uses cursor-based pagination
- **Draft auto-save**: Debounced localStorage saves prevent data loss (no beforeunload needed)
- **Skip days**: Navigation skips configured weekdays/dates
- **AI streaming**: All AI backends use async generators for streaming responses
- **Theme system**: localStorage persistence with system preference fallback
- **Webhook scheduling**: node-cron jobs with Map-based registry, auto-reload on startup, sync on CRUD
- **Webhook limits**: Maximum 5 webhooks to prevent abuse
- **Local-first architecture**: SharedWorker handles tRPC requests via MessagePort with local SQLite database; Service worker only for background sync

## Local-First Architecture

The web app uses a **SharedWorker** for local-first functionality, with a minimal service worker for background sync only.

### Why SharedWorker?
- **Immediate availability**: SharedWorker is ready on hard refresh (service worker may not be)
- **Multi-tab sharing**: All tabs share the same worker instance
- **No fetch interception complexity**: Direct MessagePort communication instead of fetch event interception
- **Simpler request routing**: tRPC link-based communication via MessagePort

### SharedWorker Module Structure (`apps/web/src/worker/`)

```
worker/
├── shared-worker-context.ts  # SharedWorkerContext factory
├── types.ts                  # Shared TypeScript types (SessionState, ServiceWorkerContext, etc.)
├── debug.ts                  # Debug utilities with category filtering
├── database.ts               # DatabaseManager - SQLite lifecycle, user switching
├── session.ts                # SessionManager - State machine (ANONYMOUS/SWITCHING/AUTHENTICATED)
├── persistence.ts            # IndexedDB layer for sql.js persistence
├── crud/
│   ├── entries.ts            # Entry CRUD (list, get, upsert, delete)
│   ├── config.ts             # Config CRUD (skip days, templates)
│   └── pending.ts            # Pending operations queue for offline sync
├── sync/
│   ├── client.ts             # SyncApiClient - Server API calls
│   └── orchestrator.ts       # SyncOrchestrator - Pull/push/fullSync coordination
└── handlers/
    ├── port.ts               # PortHandler - MessagePort routing and connection management
    ├── request.ts            # RequestHandler - tRPC request routing and execution
    └── message.ts            # MessageHandler - Control message handling (sync, debug, etc.)
```

**Entry Point**: `src/shared-worker.ts` (~60 lines) - thin composition layer that wires up all managers/handlers

**Frontend Integration**: `src/lib/shared-worker-client.ts` and `src/lib/shared-worker-link.ts` handle connection pooling and tRPC link integration

### Request Flow
1. Frontend React component → tRPC mutation/query
2. tRPC client → SharedWorkerLink → MessagePort → SharedWorker
3. SharedWorker → PortHandler → RequestHandler → CRUD modules → SQLite (sql.js) → IndexedDB
4. Auth/Webhooks bypass SharedWorker and go to backend via dev server proxy (different origin)
5. All mutations persist to IndexedDB immediately via `DatabaseManager.persist()`
6. When logged in, bidirectional sync with server using last-write-wins conflict resolution

### Service Worker (Minimal)
The service worker is now minimal (~50 lines) and only handles:
- **Background sync**: Notifies SharedWorker when browser comes back online (for pending operations)
- **Push notifications**: Placeholder for future implementation

No request interception or tRPC handling in the service worker.

### Session State Machine
```
ANONYMOUS ──LOGIN_STARTED──► SWITCHING ──LOGIN_COMPLETED──► AUTHENTICATED
                                 ▲                              │
                                 └──────LOGOUT_STARTED──────────┘
                                              │
                                              ▼
                                 SWITCHING ──LOGOUT_COMPLETED──► ANONYMOUS
```

### Debug Logging
Toggle debug logs from browser console:
```javascript
// Send message to SharedWorker to toggle debug logging
sharedWorkerClient.send({
  type: 'DEBUG_TOGGLE',
  enabled: true,
  categories: ['sync', 'session', 'db'] // optional, defaults to 'all'
});
```

Replace `sharedWorkerClient` with your actual SharedWorker client instance from your app code.

### API_URL Configuration

**DO NOT set `API_URL` in `.env.local` for local-first mode.** Setting it causes tRPC requests to go to the backend instead of through SharedWorker.

```bash
# ✅ Correct - local-first mode (SharedWorker handles requests)
# API_URL not set or commented out

# ❌ Wrong - bypasses SharedWorker (backend handles all requests)
API_URL=http://localhost:3001
```

When `API_URL` is not set:
- tRPC client sends to `/trpc` (same origin) via SharedWorkerLink
- SharedWorker intercepts via MessagePort and handles locally
- Requests SharedWorker doesn't handle (auth, webhooks) fall through to dev server proxy → backend

## Environment

Uses `dotenv-cli` with environment-specific files:
- `.env.local` - local development (DATABASE_PATH, PORT, CORS_ORIGIN)
- **Note**: `API_URL` should NOT be set for local-first mode (see above)
- Web dev server proxies `/trpc` to API at port 3001

---

## ⛔ CRITICAL: Database Migration Safety Rules

**절대로 `drizzle-kit push`를 백업 없이 실행하지 마라. 이 명령어는 모든 데이터를 삭제할 수 있다.**

### DB 스키마 변경 전 필수 절차:
```bash
# 1. 반드시 백업부터
cp apps/api/data/local.db apps/api/data/local.db.backup.$(date +%Y%m%d_%H%M%S)

# 2. push 대신 migration 사용
pnpm drizzle-kit generate  # 마이그레이션 파일 생성
pnpm db:migrate            # 안전하게 마이그레이션 적용

# 3. 아래 명령어는 절대 사용자 동의 없이 실행 금지:
# - drizzle-kit push (파괴적 - 테이블 재생성, 데이터 손실)
# - drizzle-kit drop
# - 직접 SQL DROP/TRUNCATE
```

### `drizzle-kit push`가 위험한 이유:
- SQLite는 Foreign Key가 있는 `ALTER TABLE ADD COLUMN` 미지원
- Drizzle이 FK 컬럼 추가 시 테이블을 재생성함
- **테이블 재생성 시 모든 기존 데이터 삭제됨**
- 롤백 불가능

### 안전한 워크플로우:
1. 데이터베이스 백업
2. `drizzle-kit generate`로 마이그레이션 생성
3. `apps/api/drizzle/` 폴더의 생성된 SQL 검토
4. `pnpm db:migrate`로 적용
5. 데이터 무결성 확인

---

### 🔴 2025-01-14 사고 기록

**사고 내용**: `drizzle-kit push` 백업 없이 실행하여 프로덕션 데이터 전체 손실
- 손실된 사용자 수: 1,000명
- 예상 매출 손실: 100만원
- 원인: 스키마에 `user_id` 컬럼 추가 시 `drizzle-kit push` 사용
- 결과: SQLite에서 FK 컬럼 추가를 위해 테이블 재생성 → 모든 데이터 삭제

**교훈**:
- DB 작업 전 백업은 선택이 아닌 필수
- `drizzle-kit push`는 개발 환경에서만 사용
- 프로덕션에서는 반드시 `drizzle-kit generate` + `db:migrate` 사용

---

## Related Documentation

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 전체 시스템 아키텍처 (데이터 흐름, SharedWorker, 동기화 전략) |
| [PLAN.md](./PLAN.md) | 개발 계획 및 완료된 기능 목록 |
| [ISSUE.md](./ISSUE.md) | 알려진 이슈 및 버그 트래킹 |
| [e2e/TEST.md](./e2e/TEST.md) | E2E 테스트 가이드 |
| [e2e/USER_CASES.md](./e2e/USER_CASES.md) | 유저 케이스 스펙 |
