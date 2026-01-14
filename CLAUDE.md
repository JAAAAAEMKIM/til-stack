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
- Routes:
  - `/` - Daily editor + entry list with infinite scroll
  - `/monthly` - Calendar view with weekly summaries
  - `/config` - Settings (theme, AI, skip days, templates, webhooks)
- tRPC client setup: `src/lib/trpc.ts`
- AI summarizers: `src/lib/summarizer.ts` (unified hook), with backends in `gemini-summarizer.ts`, `webllm-summarizer.ts`, `groq-summarizer.ts`, `google-ai-summarizer.ts`

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

## Environment

Uses `dotenv-cli` with environment-specific files:
- `.env.local` - local development (DATABASE_PATH, PORT, API_URL, CORS_ORIGIN)
- Web dev server proxies `/trpc` to API at port 3001
