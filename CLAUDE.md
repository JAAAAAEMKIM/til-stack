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
- tRPC router: `src/routes/entries.ts` with procedures: `upsert`, `list`, `getByDate`, `getByDateRange`, `delete`, `getWeeklySummary`, `getMonthlySummary`
- Database schema: `src/db/schema.ts`

### `apps/web` - Frontend
- **React 19** with **Rspack** bundler
- **TanStack Router** for file-based routing (`src/routes/`)
- **TanStack Query** + **tRPC React** for data fetching with optimistic updates
- **Tailwind CSS** for styling
- Routes: `/` (daily editor + entry list), `/monthly` (calendar view)
- tRPC client setup: `src/lib/trpc.ts`

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

## Environment

Uses `dotenv-cli` with environment-specific files:
- `.env.local` - local development (DATABASE_PATH, PORT, API_URL, CORS_ORIGIN)
- Web dev server proxies `/trpc` to API at port 3001
