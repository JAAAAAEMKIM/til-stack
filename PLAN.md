# TIL Stack - Development Plan

## Overview
Daily micro-journaling service for TIL, daily scrum, and short diary entries with weekly/monthly aggregation features.

## Tech Stack
- **Frontend**: React 19 + TypeScript + Rspack
- **API**: Hono + tRPC
- **Data Fetching**: TanStack Query
- **Routing**: TanStack Router
- **UI**: shadcn/ui (mobile-first, responsive)
- **Database**: SQLite3 (better-sqlite3 for server, sql.js for service worker)
- **Package Manager**: pnpm workspaces
- **Editor**: Plain textarea with markdown rendering in views
- **Architecture**: Local-first with SharedWorker (see [ARCHITECTURE.md](./ARCHITECTURE.md))

## Data Model

**Entry-to-Day relationship**: One entry per day maximum
- A day can have 0 or 1 entry
- Users can skip days (holidays, weekends, etc.)
- Users can delete an entry, leaving a day empty

## Database Schema (SQLite)
```sql
CREATE TABLE entries (
  id TEXT PRIMARY KEY,            -- nanoid
  user_id TEXT,                   -- user identifier (null for anonymous)
  date DATE UNIQUE NOT NULL,      -- one entry per date (YYYY-MM-DD)
  content TEXT NOT NULL,          -- markdown content
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE skip_days (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT,                      -- 'weekday' | 'specific_date'
  value TEXT                      -- 0-6 for weekday, YYYY-MM-DD for specific date
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_default INTEGER DEFAULT 0
);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  schedule TEXT NOT NULL,         -- cron expression
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sync_pending (
  id TEXT PRIMARY KEY,
  type TEXT,                      -- 'entry' | 'delete'
  date TEXT,
  content TEXT,
  created_at TEXT
);
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

### 3. Config Page (`/config`)
- **Theme Selector**: system/light/dark
- **Skip Days Management**: Recurring weekdays + specific dates
- **Templates CRUD**: Create/edit/delete templates with default template support
- **AI Configuration**: AI backend selection (Gemini Nano, WebLLM, Groq, Google AI)
- **Webhook Management**: Create/edit/delete webhooks with cron scheduling (max 5 webhooks)

## Completed Features

### Phase 1: Project Setup (Completed)
- [x] Initialize pnpm workspace monorepo
- [x] Set up `apps/api` with Hono + tRPC
- [x] Set up `apps/web` with React + Rspack
- [x] Configure shared package with types
- [x] Set up environment configs (local/dev/prod)

### Phase 2: Database & API (Completed)
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

### Phase 3: Frontend Core (Completed)
- [x] Configure TanStack Router with routes (`/`, `/monthly`)
- [x] Set up tRPC client + TanStack Query integration
- [x] Install and configure shadcn/ui components
- [x] Create base layout (mobile-first)

### Phase 4: Main Page (Completed)
- [x] Build date navigator component (prev/today/next)
- [x] Build entry editor (plain textarea, manual save)
- [x] Build entry card component (renders markdown with react-markdown + syntax highlighting)
- [x] Implement infinite scroll with TanStack Query (useInfiniteQuery)
- [x] Add upsert/delete functionality with optimistic updates

### Phase 5: Monthly View (Completed)
- [x] Build calendar grid component
- [x] Implement weekly summary aggregation (API + UI)
- [x] Implement monthly summary
- [x] Add month navigation

### Phase 6: Polish & Deploy (Completed)
- [x] Responsive design refinements
- [x] Environment-specific configs
- [x] Build scripts for each environment

### Phase 7: Configuration & Settings (Completed)
- [x] Add config page (`/config`) with settings sections
- [x] Database schema for skip days and templates
- [x] Skip days management (recurring weekdays + specific dates)
- [x] Templates CRUD with default template support
- [x] Theme selector (system/light/dark)
- [x] Navigation integration with skip days

### Phase 8: AI Features (Completed)
- [x] AI configuration with multiple backend support
- [x] Gemini Nano (Chrome built-in) integration
- [x] WebLLM (local LLM via WebGPU) integration
- [x] Groq Cloud API integration
- [x] Google AI (Gemini) API integration
- [x] Weekly summary generation with streaming
- [x] Custom prompt configuration
- [x] Auto-save drafts to localStorage

### Phase 9: Authentication & Multi-User Support (Completed)
- [x] Google OAuth integration
- [x] User session management
- [x] Data isolation per user (user_id column)
- [x] Anonymous data migration on first login
- [x] Service worker user switching with race condition guards
- [x] Webhook user association

### Phase 10: Service Worker Refactoring (Completed)
- [x] Extract shared types and context
- [x] Create DatabaseManager class for SQLite lifecycle
- [x] Create SessionManager with explicit state machine
- [x] Extract CRUD modules (entries, config, pending operations)
- [x] Extract sync modules (SyncApiClient, SyncOrchestrator)
- [x] Extract event handlers (message, fetch, lifecycle, request)
- [x] Modular architecture with clear dependencies
- [x] Debug logging with category filtering
- [x] Reduced service-worker.ts to ~67 lines (composition only)

### Phase 11: Bug Fixes & Stability (Completed)
- [x] Fix anonymous user database initialization bug
- [x] Fix login stuck and sync data issues
- [x] Add USER_ANONYMOUS message type for anonymous initialization
- [x] Improve auth-SW coordination with await pattern
- [x] Add comprehensive login flow tests
- [x] Add multi-user switching tests

## Archived Reference: Sync Issues (2026-01-15)

> **Note**: These issues were identified during architecture review. Most have been addressed through the service worker refactor and bug fixes. This section is kept for historical reference.

### ~~P1: Config Data Server Sync (Addressed)~~
Config data (skip_days, templates) is now properly synchronized through the service worker's sync orchestrator.

### ~~P2: Pull - Deleted Items Not Handled (Known Limitation)~~
Currently, server-side deletions are not propagated to other devices. Implementing tombstone pattern (soft delete with `deleted_at` column) would require schema migration. Deferred as low priority - users typically delete on their primary device.

### ~~P3: Anonymous Data Orphaning (Fixed)~~
Fixed via `USER_ANONYMOUS` message type that ensures database initialization regardless of navigation path.

### ~~P4: Server Pull Pagination (Known Limitation)~~
Server pull is limited to 1000 entries. This is acceptable for TIL use case (1000 days = ~3 years). Can be addressed with cursor-based pagination if needed.

## Future Improvements

### High Priority
- [ ] Add test infrastructure (vitest) and basic API tests
- [ ] Add keyboard shortcuts (Cmd+S to save, Esc to cancel)
- [ ] Implement search functionality for entries
- [ ] Add error boundary to prevent full-app crashes
- [ ] Extract shared date utilities to reduce duplication

### Medium Priority
- [ ] Split large route files into smaller components
- [ ] Create proper component library (input, dialog, etc.)
- [ ] Improve calendar to show skipped days (grayed out)
- [ ] Use human-friendly date format (Mon, Jan 6) in navigator
- [ ] Add data export/import for backup
- [ ] Implement tombstone pattern for sync deletions

### Low Priority
- [ ] Add loading states for all mutations
- [ ] Consistent error handling across AI backends
- [ ] Replace native confirm() with custom dialog
- [ ] Server pull pagination for >1000 entries

### Template Variables
Support dynamic placeholders in templates:
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{dayOfWeek}}` - Day name (Monday, Tuesday, etc.)
- `{{week}}` - Week number of year
- `{{month}}` - Month name

Templates would be processed at entry creation time, replacing variables with actual values.

## Decisions Made

### Auto-save vs beforeunload warning
We chose auto-save drafts to localStorage over beforeunload warnings because:
- Drafts are saved every 500ms with debounce
- Content is restored when returning to a date
- Better UX than disruptive browser dialogs
- Works across page refreshes and tab switches

### Local-first architecture
- Service worker intercepts all `/trpc` requests for entries, config, skip days, and templates
- Only auth and webhooks go to backend (require server-side processing)
- Bidirectional sync when logged in (pull on login, push on mutations)
- Last-write-wins conflict resolution based on `updated_at` timestamp

### Session state machine
Explicit state machine (`ANONYMOUS → SWITCHING → AUTHENTICATED`) prevents race conditions during rapid user switching.

### AI backend flexibility
Support multiple AI backends (local and cloud) to give users choice between privacy (local) and quality (cloud).

---

## Database Migration Safety Rules

**⚠️ CRITICAL: Never run `drizzle-kit push` without backup. This command can delete all data.**

### Required Procedure for Schema Changes:
```bash
# 1. Always backup first
cp apps/api/data/local.db apps/api/data/local.db.backup.$(date +%Y%m%d_%H%M%S)

# 2. Use migrations instead of push
pnpm drizzle-kit generate  # Generate migration file
pnpm db:migrate            # Apply migration safely

# 3. NEVER run these without user approval:
# - drizzle-kit push (destructive - recreates tables, loses data)
# - drizzle-kit drop
# - Direct SQL DROP/TRUNCATE
```

### Why `drizzle-kit push` is Dangerous:
- SQLite doesn't support `ALTER TABLE ADD COLUMN` with Foreign Keys
- Drizzle recreates tables when adding FK columns
- **Table recreation deletes all existing data**
- No rollback possible

### Safe Workflow:
1. Backup database
2. `drizzle-kit generate` to create migration
3. Review generated SQL in `apps/api/drizzle/`
4. `pnpm db:migrate` to apply
5. Verify data integrity

### 2025-01-14 Incident Record
**Incident**: Ran `drizzle-kit push` without backup, lost all production data
- Lost users: 1,000
- Estimated revenue loss: 1,000,000 KRW
- Cause: Added `user_id` column to schema, used `drizzle-kit push`
- Result: Table recreation deleted all data

**Lessons**:
- Database backups are mandatory, not optional
- Use `drizzle-kit push` only in development
- Use `drizzle-kit generate` + `db:migrate` in production

---

*Last updated: 2026-01-30*
