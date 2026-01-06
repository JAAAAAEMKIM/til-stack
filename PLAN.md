# TIL Stack - Implementation Plan

## Overview
Daily micro-journaling service for TIL, daily scrum, and short diary entries with weekly/monthly aggregation features.

## Tech Stack
- **Frontend**: React + TypeScript + Rspack
- **API**: Hono + tRPC
- **Data Fetching**: TanStack Query
- **Routing**: TanStack Router
- **UI**: shadcn/ui (mobile-first, responsive)
- **Database**: SQLite3 (all environments)
- **Package Manager**: pnpm workspaces
- **Editor**: Plain textarea with markdown rendering in views

## Project Structure
```
til-stack/
├── pnpm-workspace.yaml
├── package.json
├── .env.local / .env.dev / .env.prod
├── apps/
│   ├── web/                    # Frontend
│   │   ├── src/
│   │   │   ├── routes/         # TanStack Router pages
│   │   │   ├── components/     # UI components
│   │   │   ├── lib/            # Utilities, trpc client
│   │   │   └── styles/
│   │   ├── rspack.config.ts
│   │   └── package.json
│   └── api/                    # Backend
│       ├── src/
│       │   ├── routes/         # tRPC routers
│       │   ├── db/             # SQLite schema, migrations
│       │   └── index.ts        # Hono server entry
│       └── package.json
└── packages/
    └── shared/                 # Shared types, validators
        ├── src/
        │   ├── types.ts
        │   └── validators.ts   # Zod schemas
        └── package.json
```

## Data Model

**Entry-to-Day relationship**: One entry per day maximum
- A day can have 0 or 1 entry
- Users can skip days (holidays, weekends, etc.)
- Users can delete an entry, leaving a day empty

## Database Schema (SQLite)
```sql
CREATE TABLE entries (
  id TEXT PRIMARY KEY,            -- nanoid
  date DATE UNIQUE NOT NULL,      -- one entry per date (YYYY-MM-DD)
  content TEXT NOT NULL,          -- markdown content
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_entries_date ON entries(date);
```

## Pages & Features

### 1. Main Page (`/`)
- **Top/Center**: Date navigator (← prev | today | next →)
- **Center**: Markdown editor for the selected date's entry
  - If entry exists: edit mode
  - If no entry: create mode
  - Save/delete actions
- **Below**: Infinite scroll list of all entries (newest first)
  - Entry card shows: date, content preview (rendered markdown)
  - Click to navigate to that date's editor

### 2. Monthly View (`/monthly`)
- Calendar grid showing current month
- Click on day → navigate to that day's editor on main page
- **Right column**: Weekly summary (Mon-Sun aggregated)
- **Bottom/Top**: Monthly summary button/section
- Navigation: prev/next month

## Implementation Phases

### Phase 1: Project Setup
- [x] Initialize pnpm workspace monorepo
- [x] Set up `apps/api` with Hono + tRPC
- [x] Set up `apps/web` with React + Rspack
- [x] Configure shared package with types
- [x] Set up environment configs (local/dev/prod)

### Phase 2: Database & API
- [x] Set up SQLite with better-sqlite3
- [x] Configure drizzle-orm for schema/migrations
- [x] Create entries table schema
- [x] Implement tRPC routers:
  - `entries.upsert` - create or update entry for a date
  - `entries.list` - paginated list (for infinite scroll)
  - `entries.getByDate` - get entry for specific date (or null)
  - `entries.getByDateRange` - for weekly/monthly views
  - `entries.delete` - delete entry by date
  - `entries.getWeeklySummary` - on-demand weekly aggregation
  - `entries.getMonthlySummary` - on-demand monthly aggregation

### Phase 3: Frontend Core
- [x] Configure TanStack Router with routes (`/`, `/monthly`)
- [x] Set up tRPC client + TanStack Query integration
- [x] Install and configure shadcn/ui components
- [x] Create base layout (mobile-first)

### Phase 4: Main Page
- [x] Build date navigator component (prev/today/next)
- [x] Build entry editor (plain textarea, manual save)
- [x] Build entry card component (renders markdown with react-markdown + syntax highlighting)
- [x] Implement infinite scroll with TanStack Query (useInfiniteQuery)
- [x] Add upsert/delete functionality with optimistic updates

### Phase 5: Monthly View
- [x] Build calendar grid component
- [x] Implement weekly summary aggregation (API + UI)
- [x] Implement monthly summary
- [x] Add month navigation

### Phase 6: Polish & Deploy
- [x] Responsive design refinements
- [x] Environment-specific configs
- [x] Build scripts for each environment

## Key Dependencies

### API (`apps/api`)
```
hono
@hono/trpc-server
@trpc/server
better-sqlite3
drizzle-orm
zod
nanoid
```

### Web (`apps/web`)
```
react
@tanstack/react-query
@tanstack/react-router
@trpc/client
@trpc/react-query
tailwindcss
react-markdown
remark-gfm
rehype-highlight
@rspack/cli
```

### Shared (`packages/shared`)
```
zod
typescript
```

## Environment Config

| Env | SQLite Path | API URL |
|-----|-------------|---------|
| local | `./data/local.db` | `localhost:3001` |
| dev | `./data/dev.db` | staging URL |
| prod | `/data/prod.db` | production URL |

## Decisions Made
- **Summaries**: On-demand (calculated when viewed)
- **Markdown**: Extended (bold, italic, links, code blocks, lists)
- **Date model**: One entry per day max, navigate with prev/today/next
- **Entry UX**: Click any entry in list to jump to that date's editor
- **Editor**: Plain textarea (markdown rendered only in entry list/view)
