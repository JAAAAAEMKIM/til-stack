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
- **Service Worker** for local-first offline database (`src/service-worker.ts`)
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
- **Local-first architecture**: Service worker intercepts `/trpc` requests and handles them with local SQLite database

## Local-First Architecture

The web app uses a **service worker** (`src/service-worker.ts`) to provide offline-first functionality:

1. **Request Flow**: Frontend → `/trpc` (same origin) → Service Worker → Local SQLite (sql.js) → IndexedDB
2. **Auth/Webhooks**: Pure auth or webhook batches bypass SW and go to backend via dev server proxy
3. **Data Persistence**: All mutations call `await persistDatabase()` to save to IndexedDB immediately
4. **Sync**: When logged in, bidirectional sync with server using last-write-wins conflict resolution

### Critical: API_URL Configuration

**DO NOT set `API_URL` in `.env.local` for local-first mode.** Setting it bypasses the service worker entirely.

```bash
# ✅ Correct - local-first mode (service worker handles requests)
# API_URL not set or commented out

# ❌ Wrong - bypasses service worker (cross-origin requests)
API_URL=http://localhost:3001
```

When `API_URL` is not set:
- tRPC client sends to `/trpc` (same origin)
- Service worker intercepts and handles locally
- Requests SW doesn't handle fall through to dev server proxy → backend

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
