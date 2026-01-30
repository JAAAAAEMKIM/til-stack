# TIL Stack - Architecture

## Overview

TIL Stack is a **local-first micro-journaling application** designed for daily learning and reflection. The application prioritizes offline-first functionality with seamless cloud synchronization when online, ensuring users never lose their work and can access their entries across devices.

### Core Principles
- **Local-First**: All data operations happen locally in the browser via SQLite (sql.js)
- **Offline-Ready**: Full CRUD functionality works completely offline
- **Sync-When-Online**: Background synchronization to server when authenticated
- **Privacy-Focused**: Complete namespace isolation between users
- **Type-Safe**: End-to-end type safety via tRPC

### Tech Stack Summary

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TanStack Router, TanStack Query |
| **Styling** | Tailwind CSS, shadcn/ui |
| **API Client** | tRPC React |
| **Offline Storage** | sql.js (SQLite WASM), IndexedDB |
| **Worker Architecture** | SharedWorker (primary), Service Worker (background sync only) |
| **Backend** | Hono, tRPC |
| **Database** | SQLite (better-sqlite3), Drizzle ORM |
| **Auth** | Google OAuth, JWT (jose) |
| **Build** | Rspack, pnpm monorepo |

---

## System Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                       TIL Stack Application                            │
├───────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                     Frontend Layer                            │    │
│  │                                                               │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │    │
│  │  │ Editor   │  │ Monthly  │  │ Settings │  │ Login    │    │    │
│  │  │ (/)      │  │ (/monthly)│  │ (/config)│  │ (/login) │    │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │    │
│  │                                                               │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │ TanStack Query + tRPC Client                         │   │    │
│  │  │ (SharedWorkerLink for local-first operations)        │   │    │
│  │  └───────────────────────┬──────────────────────────────┘   │    │
│  │                          │                                   │    │
│  └──────────────────────────┼───────────────────────────────────┘    │
│                             │                                        │
│                             │ MessagePort                            │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                     SharedWorker Layer                        │    │
│  │                                                               │    │
│  │  ┌─────────────────────────────────────────────────────┐     │    │
│  │  │ PortHandler → Route tRPC requests                   │     │    │
│  │  │  ├─ auth.*      → Backend (OAuth flow)              │     │    │
│  │  │  ├─ webhooks.*  → Backend (server-side scheduler)   │     │    │
│  │  │  ├─ entries.*   → Local (sql.js + IndexedDB)        │     │    │
│  │  │  └─ config.*    → Local (sql.js + IndexedDB)        │     │    │
│  │  └─────────────────────────────────────────────────────┘     │    │
│  │                             │                                │    │
│  │                             ▼                                │    │
│  │  ┌─────────────────────────────────────────────────────┐     │    │
│  │  │ DatabaseManager (sql.js - SQLite WASM)              │     │    │
│  │  │                                                      │     │    │
│  │  │  Tables:                                             │     │    │
│  │  │  ├─ entries (id, date, content, user_id, ...)       │     │    │
│  │  │  ├─ skip_days (id, type, value, user_id, ...)       │     │    │
│  │  │  ├─ templates (id, name, content, is_default, ...)  │     │    │
│  │  │  └─ sync_pending (id, type, date, payload, ...)     │     │    │
│  │  └─────────────────────────────────────────────────────┘     │    │
│  │                             │                                │    │
│  │                             ▼                                │    │
│  │  ┌─────────────────────────────────────────────────────┐     │    │
│  │  │ Persistence Layer (IndexedDB)                        │     │    │
│  │  │                                                      │     │    │
│  │  │ Database: "til-stack-local"                         │     │    │
│  │  │ Store: "database"                                    │     │    │
│  │  │                                                      │     │    │
│  │  │ Keys:                                                │     │    │
│  │  │  ├─ sqlite-data-anonymous                           │     │    │
│  │  │  ├─ sqlite-data-user_123                            │     │    │
│  │  │  └─ sqlite-data-user_456                            │     │    │
│  │  └─────────────────────────────────────────────────────┘     │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │             Service Worker (Background Only)                  │    │
│  │  ├─ Background Sync: Notify SharedWorker when online          │    │
│  │  └─ Push Notifications: Placeholder for future               │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│            ┌──────────────────────────────────────┐                   │
│            │ Auth & Webhooks → Backend API        │                   │
│            │ Sync Operations ↔ Backend API        │                   │
│            └──────────────────────────────────────┘                   │
│                             │                                         │
└─────────────────────────────┼─────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        Backend Layer (API)                             │
├───────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                         Hono Server                           │    │
│  │                                                               │    │
│  │  ┌─────────────────────────────────────────────────────┐     │    │
│  │  │ Routes                                               │     │    │
│  │  │  ├─ /trpc/*  → tRPC Handler                         │     │    │
│  │  │  ├─ /auth/*  → OAuth Flow (Google)                  │     │    │
│  │  │  └─ /health  → Health Check                         │     │    │
│  │  └─────────────────────────────────────────────────────┘     │    │
│  │                             │                                │    │
│  │                             ▼                                │    │
│  │  ┌─────────────────────────────────────────────────────┐     │    │
│  │  │ tRPC Routers                                         │     │    │
│  │  │  ├─ auth      (me, logout, deleteAccount, migrate)  │     │    │
│  │  │  ├─ entries   (upsert, list, getByDate, delete, ...)│     │    │
│  │  │  ├─ config    (skipDays, templates, ...)            │     │    │
│  │  │  └─ webhooks  (list, create, update, delete, test)  │     │    │
│  │  └─────────────────────────────────────────────────────┘     │    │
│  │                             │                                │    │
│  │                             ▼                                │    │
│  │  ┌─────────────────────────────────────────────────────┐     │    │
│  │  │ SQLite Database (better-sqlite3)                     │     │    │
│  │  │                                                      │     │    │
│  │  │ Tables:                                              │     │    │
│  │  │  ├─ users (id, google_id)                           │     │    │
│  │  │  ├─ entries (id, date, content, user_id, deleted_at)│     │    │
│  │  │  ├─ skip_days (id, type, value, user_id)            │     │    │
│  │  │  ├─ templates (id, name, content, user_id, ...)     │     │    │
│  │  │  └─ webhooks (id, name, url, time, days, user_id)   │     │    │
│  │  └─────────────────────────────────────────────────────┘     │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend (apps/web)

### Technology Stack
- **React 19**: Latest React with concurrent rendering features
- **TanStack Router**: File-based routing with type-safe navigation
- **TanStack Query**: Server state management with caching and optimistic updates
- **tRPC React**: Type-safe API calls with React Query integration
- **Tailwind CSS + shadcn/ui**: Styling with accessible component library
- **Rspack**: Fast bundler (Webpack replacement)

### Route Structure

```
src/routes/
├── __root.tsx              # Root layout with AuthProvider
├── index.tsx               # Daily editor + entry list (infinite scroll)
├── monthly.tsx             # Calendar view with weekly summaries
├── config.tsx              # Settings (theme, AI, skip days, templates, webhooks)
├── login.tsx               # Google OAuth login
└── auth/
    └── callback.tsx        # OAuth callback with data migration
```

### Key Features

#### Daily Editor (`/`)
- Single entry per day (upsert pattern)
- Auto-save to localStorage (debounced 500ms)
- Markdown support
- AI summarization (Gemini, WebLLM, Groq, Google AI)
- Infinite scroll entry list with cursor-based pagination

#### Monthly View (`/monthly`)
- Calendar view of all entries
- Weekly summaries with streak tracking
- Entry density visualization
- Navigation with skip days support

#### Configuration (`/config`)
- Theme selection (light/dark/system)
- AI provider configuration
- Skip days management (weekdays and specific dates)
- Entry templates with default selection
- Webhook management (max 5 webhooks)

### tRPC Client Setup

Location: `src/lib/trpc.ts`

```typescript
// Uses SharedWorkerLink for local-first operations
const links = [
  splitLink({
    condition: (op) => shouldUseLocal(op.path), // entries.*, config.*
    true: sharedWorkerLink(),                   // → SharedWorker
    false: httpBatchLink({ url: API_URL }),     // → Backend (auth.*, webhooks.*)
  }),
];
```

### AI Summarization

Location: `src/lib/summarizer.ts` and backends

- **Unified Hook**: `useSummarizer()` provides streaming interface
- **Backends**:
  - `gemini-summarizer.ts`: Google Gemini API
  - `webllm-summarizer.ts`: Local WebLLM (privacy-focused)
  - `groq-summarizer.ts`: Groq API
  - `google-ai-summarizer.ts`: Google AI Studio
- **Pattern**: All backends use async generators for streaming responses

---

## SharedWorker (Local-First Core)

### Why SharedWorker Over Service Worker?

| Feature | SharedWorker | Service Worker |
|---------|--------------|----------------|
| **Availability on hard refresh** | ✅ Immediate | ❌ May not be active |
| **Multi-tab data sharing** | ✅ Same instance | ❌ Per-tab state |
| **Request handling** | ✅ Direct MessagePort | ❌ Fetch event interception |
| **Debugging complexity** | ✅ Simpler | ❌ More complex |
| **Background sync** | ❌ Not supported | ✅ Supported |

**Decision**: Use SharedWorker for tRPC requests and local database, minimal Service Worker only for background sync.

### Module Structure

```
apps/web/src/worker/
├── shared-worker-context.ts  # Factory for SharedWorkerContext
├── types.ts                  # TypeScript interfaces (SessionState, etc.)
├── debug.ts                  # Category-based debug logging
├── database.ts               # DatabaseManager - SQLite lifecycle
├── session.ts                # SessionManager - ANONYMOUS/AUTHENTICATED state
├── persistence.ts            # IndexedDB save/load for sql.js
├── crud/
│   ├── entries.ts            # Entry CRUD (list, get, upsert, delete)
│   ├── config.ts             # Config CRUD (skip days, templates)
│   └── pending.ts            # Pending operations queue for offline sync
├── sync/
│   ├── client.ts             # SyncApiClient - Backend API calls
│   └── orchestrator.ts       # SyncOrchestrator - Sync coordination
└── handlers/
    ├── port.ts               # PortHandler - MessagePort connection mgmt
    ├── request.ts            # RequestHandler - tRPC request routing
    └── message.ts            # MessageHandler - Control messages (sync, debug)
```

### Entry Point

`apps/web/src/shared-worker.ts` (~60 lines):

```typescript
// Singleton instances shared across all tabs
const ctx = createSharedWorkerContext();
const dbManager = new DatabaseManager(ctx);
const sessionManager = new SessionManager(ctx, dbManager);
const syncOrchestrator = new SyncOrchestrator(ctx, dbManager);
const requestHandler = new RequestHandler(ctx, dbManager, syncOrchestrator);
const messageHandler = new MessageHandler(ctx, sessionManager, syncOrchestrator);
const portHandler = new PortHandler(ctx, requestHandler, messageHandler);

// Handle new tab connections
self.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = (e) => portHandler.handleMessage(port, e.data);
  port.start();
};
```

### Request Flow

```
1. React Component
       ↓
   tRPC Query/Mutation
       ↓
2. SharedWorkerLink (via MessagePort)
       ↓
3. SharedWorker
       ↓
   PortHandler.handleMessage()
       ↓
4. RequestHandler.route()
       ↓
   ┌──────────────────────────────┐
   │ entries.* → EntryCrud        │
   │ config.*  → ConfigCrud       │
   │ auth.*    → Backend (bypass) │
   │ webhooks.*→ Backend (bypass) │
   └──────────────────────────────┘
       ↓
5. DatabaseManager
       ↓
   sql.js (SQLite WASM)
       ↓
6. Persistence.saveToIndexedDB()
       ↓
   IndexedDB (persistent storage)
```

### Database Tables (sql.js)

Each user's database contains:

#### entries
```sql
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,      -- YYYY-MM-DD
  content TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### skip_days
```sql
CREATE TABLE skip_days (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'weekday' | 'specific_date'
  value TEXT NOT NULL,             -- '0-6' for weekday, 'YYYY-MM-DD' for date
  user_id TEXT,
  created_at TEXT NOT NULL
);
```

#### templates
```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,   -- Boolean (0 or 1)
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### sync_pending
```sql
CREATE TABLE sync_pending (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'upsert' | 'delete' | 'skip_day' | 'template'
  date TEXT,                       -- For entries
  content TEXT,                    -- For entries
  payload TEXT,                    -- JSON for config operations
  created_at TEXT NOT NULL
);
```

---

## Service Worker (Minimal)

Location: `apps/web/src/service-worker.ts` (~50 lines)

**Purpose**: Only handles background sync, not tRPC requests.

```typescript
// Background Sync: Notify SharedWorker when browser comes online
self.addEventListener('sync', async (event) => {
  if (event.tag === 'sync-pending-operations') {
    // Send message to SharedWorker to trigger sync
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({ type: 'BACKGROUND_SYNC' });
    });
  }
});

// Push Notifications: Placeholder for future
self.addEventListener('push', async (event) => {
  // Future: Show notification for reminders
});
```

**No fetch event interception** - all tRPC requests go through SharedWorker via MessagePort.

---

## Backend (apps/api)

### Technology Stack
- **Hono**: Fast, lightweight web framework
- **tRPC**: End-to-end type-safe API
- **SQLite** (better-sqlite3): Embedded SQL database
- **Drizzle ORM**: Type-safe SQL query builder
- **jose**: JWT authentication

### tRPC Routers

#### auth (`src/routes/auth.ts`)
- `getGoogleAuthUrl`: Generate OAuth URL
- `me`: Get current user
- `logout`: Clear JWT cookie
- `deleteAccount`: Hard delete user and all data
- `migrateData`: Migrate anonymous data to user account

#### entries (`src/routes/entries.ts`)
- `upsert`: Create or update entry by date
- `list`: Paginated entry list (cursor-based)
- `getByDate`: Get single entry
- `getByDateRange`: Get entries in date range
- `delete`: Soft delete entry (sets `deleted_at`)
- `getWeeklySummary`: Stats for week
- `getMonthlySummary`: Stats for month

#### config (`src/routes/config.ts`)
- `getSkipDays`: Get all skip days
- `addSkipWeekday`: Add recurring weekday
- `addSkipDate`: Add specific date
- `removeSkipDay`: Remove skip day
- `getTemplates`: Get all templates
- `getDefaultTemplate`: Get default template
- `createTemplate`: Create new template
- `updateTemplate`: Update template
- `deleteTemplate`: Delete template
- `setDefaultTemplate`: Set default template

#### webhooks (`src/routes/webhooks.ts`)
- `list`: Get user's webhooks (max 5)
- `create`: Create new webhook
- `update`: Update webhook
- `delete`: Delete webhook
- `test`: Send test webhook immediately

### Webhook Scheduler

Location: `src/lib/webhook-scheduler.ts`

- **Technology**: node-cron for scheduling
- **Registry**: In-memory Map of webhook ID → cron job
- **Lifecycle**:
  1. Load all enabled webhooks on server start
  2. Schedule cron jobs based on time + days + timezone
  3. Auto-reload on CRUD operations (create/update/delete)
- **Limit**: Maximum 5 webhooks per user

### Database Schema

Location: `src/db/schema.ts`

#### users
```typescript
{
  id: text().primaryKey(),
  googleId: text().notNull().unique(),
  createdAt: text().notNull(),
}
```

#### entries
```typescript
{
  id: text().primaryKey(),
  date: text().notNull(),           // YYYY-MM-DD
  content: text().notNull(),
  userId: text(),                   // nullable for backward compat
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
  deletedAt: text(),                // Soft delete tombstone
}
// Unique index: (date, userId)
```

#### skip_days
```typescript
{
  id: text().primaryKey(),
  type: text().notNull(),           // 'weekday' | 'specific_date'
  value: text().notNull(),
  userId: text(),
  createdAt: text().notNull(),
}
```

#### templates
```typescript
{
  id: text().primaryKey(),
  name: text().notNull(),
  content: text().notNull(),
  isDefault: integer({ mode: 'boolean' }),
  userId: text(),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
}
```

#### webhooks
```typescript
{
  id: text().primaryKey(),
  name: text().notNull(),
  url: text().notNull(),
  message: text().notNull(),
  time: text().notNull(),           // "HH:MM"
  days: text().notNull(),           // JSON: ["mon","tue",...]
  timezone: text().notNull(),
  enabled: integer({ mode: 'boolean' }),
  userId: text(),
  createdAt: text().notNull(),
  updatedAt: text().notNull(),
}
```

---

## Data Flow

### Guest User Flow (Not Logged In)

```
┌──────────┐     ┌──────────────┐     ┌─────────┐     ┌───────────┐
│  React   │────▶│ SharedWorker │────▶│  sql.js │────▶│ IndexedDB │
│   App    │     │              │     │  (WASM) │     │  (local)  │
└──────────┘     └──────────────┘     └─────────┘     └───────────┘
                        │
                        │ (auth.*, webhooks.* bypass to backend)
                        ▼
                 ┌──────────────┐
                 │    Backend   │
                 └──────────────┘
```

**Characteristics**:
- All entries/config stored in `sqlite-data-anonymous` key
- Works completely offline
- No server sync
- Webhooks disabled (requires authentication)

### Authenticated User Flow

```
┌──────────┐     ┌──────────────┐     ┌─────────┐     ┌───────────┐
│  React   │────▶│ SharedWorker │────▶│  sql.js │────▶│ IndexedDB │
│   App    │     │              │     │  (WASM) │     │ (primary) │
└──────────┘     └──────────────┘     └─────────┘     └───────────┘
                        │                   │
                        │                   │ Bidirectional Sync
                        │                   ▼
                        │            ┌──────────────┐
                        └───────────▶│    Backend   │
                          auth.*     │   (backup)   │
                          webhooks.* └──────────────┘
```

**Characteristics**:
- IndexedDB remains primary data source
- Background sync to server (last-write-wins)
- Works offline, syncs when online
- Webhooks enabled

### Sync Strategy (Last-Write-Wins)

```
1. Trigger Sync
   ├─ On app load (if logged in)
   ├─ After mutation (debounced 2s)
   └─ Manual (sync button)

2. Fetch Data
   ├─ Get all local entries from IndexedDB
   └─ Get all server entries via tRPC

3. Compare by Date
   For each date:
   ┌─────────────────────────────────────────┐
   │ Local Only?    → Push to Server         │
   │ Server Only?   → Pull to Local          │
   │ Both Exist?    → Compare updatedAt      │
   │   └─ Local newer?  → Push to Server    │
   │   └─ Server newer? → Pull to Local     │
   │   └─ Same?         → Skip (synced)     │
   └─────────────────────────────────────────┘

4. Update Last Synced Timestamp
```

### Authentication Flow (Google OAuth)

```
1. User clicks "Sign in with Google"
             ↓
2. GET /trpc/auth.getGoogleAuthUrl
             ↓
3. Redirect to Google OAuth consent screen
             ↓
4. Callback: GET /auth/callback?code=xxx
             ↓
5. Exchange code for tokens (server-side)
             ↓
6. Create/find user in database
             ↓
7. Generate JWT, set httpOnly cookie
             ↓
8. Redirect to app (/auth/callback route)
             ↓
9. Frontend: Send USER_LOGIN message to SharedWorker
             ↓
10. SharedWorker: Migrate/pull data, switch namespace
             ↓
11. Initial sync to server
```

---

## User Data Lifecycle

### Anonymous User Storage

**Storage Key**: `sqlite-data-anonymous`

- User creates entries without authentication
- All data stored locally in IndexedDB
- Persists across sessions
- No server sync
- Completely isolated from authenticated data

### First-Time Login (isNewUser=true)

**Policy**: MIGRATE anonymous data to user namespace

```
Before Migration:
IndexedDB:
  ├─ sqlite-data-anonymous: [Entry A, B, C]
  └─ sqlite-data-user_123: (empty)

After Migration:
IndexedDB:
  ├─ sqlite-data-anonymous: (cleared)
  └─ sqlite-data-user_123: [Entry A, B, C]
Server:
  └─ user_123: [Entry A, B, C] (after sync)
```

**Steps**:
1. Check for anonymous data
2. Copy database to user namespace
3. Clear anonymous storage
4. Perform full sync to server
5. User sees all their work preserved in account

### Returning User Login (isNewUser=false)

**Policy**: PRESERVE anonymous data, load user's server data

```
Before Login:
IndexedDB:
  ├─ sqlite-data-anonymous: [Entry X: "Personal note"]
  └─ (no user data)
Server:
  └─ user_123: [Entry A, B, C]

After Login:
IndexedDB:
  ├─ sqlite-data-anonymous: [Entry X] ← PRESERVED
  └─ sqlite-data-user_123: [Entry A, B, C]
```

**Steps**:
1. Switch to user namespace
2. Pull data from server
3. Anonymous data remains untouched
4. User sees only account data

**Rationale**: Prevents Device A's anonymous notes from polluting Device B's account.

### Logout Behavior

**Policy**: Return to anonymous namespace, retain user data

```
Before Logout:
IndexedDB:
  ├─ sqlite-data-anonymous: [Entry X]
  └─ sqlite-data-user_123: [Entry A, B, C]
SharedWorker: currentUserId = user_123

After Logout:
IndexedDB:
  ├─ sqlite-data-anonymous: [Entry X] ← Now active
  └─ sqlite-data-user_123: [Entry A, B, C] ← Preserved
SharedWorker: currentUserId = null
```

**Optional Clear**: User can choose to clear current namespace on logout (for shared devices).

### IndexedDB Namespace Isolation

```
Database: "til-stack-local"
Store: "database"

Keys:
├─ sqlite-data-anonymous        # Anonymous user
├─ sqlite-data-user_123         # User 123
└─ sqlite-data-user_456         # User 456

Each key stores complete SQLite database (Uint8Array):
  ├─ entries table
  ├─ skip_days table
  ├─ templates table
  └─ sync_pending table
```

**Benefits**:
- **Security**: Impossible to leak data between users
- **Simplicity**: No complex filtering logic
- **Testability**: Easy to verify isolation

---

## Session State Machine

```
ANONYMOUS ──LOGIN_STARTED──► SWITCHING ──LOGIN_COMPLETED──► AUTHENTICATED
                                 ▲                              │
                                 └──────LOGOUT_STARTED──────────┘
                                              │
                                              ▼
                                 SWITCHING ──LOGOUT_COMPLETED──► ANONYMOUS
```

### States

| State | Description | Current User ID |
|-------|-------------|-----------------|
| `ANONYMOUS` | Not logged in | `null` |
| `SWITCHING` | Login/logout in progress | Transitioning |
| `AUTHENTICATED` | Logged in | User ID string |

### Events

- `LOGIN_STARTED`: User begins OAuth flow
- `LOGIN_COMPLETED`: OAuth success, data migrated/pulled
- `LOGOUT_STARTED`: User clicks logout
- `LOGOUT_COMPLETED`: Namespace switched to anonymous

---

## Key Design Decisions

### 1. SharedWorker for Local-First

**Decision**: Use SharedWorker instead of Service Worker for tRPC requests.

**Why**:
- **Reliability**: Available immediately on hard refresh (Service Worker may not be)
- **Multi-tab**: All tabs share same database instance (no synchronization needed)
- **Simplicity**: Direct MessagePort communication vs. fetch event interception
- **Debugging**: Easier to inspect and debug

**Trade-off**: Service Worker still needed for background sync (when browser is offline).

### 2. Complete Namespace Isolation

**Decision**: Each user has separate IndexedDB key with own database.

**Why**:
- **Security**: Impossible to accidentally leak data between users
- **Clarity**: Clean separation of concerns
- **Performance**: No filtering overhead on queries

**Alternative Rejected**: Single database with `user_id` filters (higher risk of bugs).

### 3. Migrate vs. Merge on First Login

**Decision**: New users have anonymous data MIGRATED (moved), not MERGED.

**Why**:
- **Ownership**: Anonymous work becomes the user's account data
- **Idempotency**: Can't accidentally create duplicates
- **Clear UX**: "When you log in, your work becomes your account's work"

### 4. Preserve Anonymous Data on Return Login

**Decision**: Returning users' anonymous data is NOT merged into account.

**Why**:
- **Preservation**: Offline work while logged out isn't lost
- **Multi-device**: Prevents Device A's anonymous data from polluting Device B
- **Control**: User decides whether to keep anonymous data

### 5. Last-Write-Wins Conflict Resolution

**Decision**: Newer `updatedAt` timestamp wins on sync conflicts.

**Why**:
- **Deterministic**: No user intervention needed
- **Predictable**: Consistent behavior across devices
- **Simple**: No complex 3-way merge logic

**Trade-off**: Potential data loss if edits happen on two devices simultaneously (rare in micro-journaling).

### 6. API_URL Configuration

**Critical**: `API_URL` must NOT be set in `.env.local` for local-first mode.

```bash
# ✅ Correct - local-first (SharedWorker handles)
# API_URL not set

# ❌ Wrong - bypasses SharedWorker
API_URL=http://localhost:3001
```

**Why**: Setting `API_URL` sends all tRPC requests to backend instead of SharedWorker.

---

## Monorepo Structure

```
til-stack/
├── apps/
│   ├── api/                    # Backend (Hono + tRPC)
│   │   ├── src/
│   │   │   ├── index.ts       # Entry point
│   │   │   ├── routes/        # tRPC routers
│   │   │   ├── db/            # Drizzle schema
│   │   │   └── lib/           # Webhook scheduler, auth
│   │   ├── drizzle/           # Migrations
│   │   └── data/              # SQLite database file
│   │
│   └── web/                    # Frontend (React)
│       ├── src/
│       │   ├── routes/        # TanStack Router routes
│       │   ├── lib/           # tRPC client, auth, AI
│       │   ├── worker/        # SharedWorker modules
│       │   ├── shared-worker.ts  # SharedWorker entry
│       │   └── service-worker.ts # Service Worker (minimal)
│       └── public/            # Static assets
│
└── packages/
    └── shared/                 # Shared code
        └── src/
            ├── types.ts       # TypeScript interfaces
            └── validators.ts  # Zod schemas
```

---

## Recent Changes

### SharedWorker Migration (2026-01-29)

**Problem**: Service Worker not reliably active on hard refresh, causing tRPC requests to fail.

**Solution**: Moved tRPC handling from Service Worker to SharedWorker.

**Changes**:
- Created `shared-worker.ts` with modular handler architecture
- Implemented SharedWorkerLink for tRPC client
- Reduced Service Worker to ~50 lines (background sync only)
- Added connection pooling for MessagePort management

**Benefits**:
- ✅ Immediate availability on page load
- ✅ Multi-tab data sharing (all tabs use same worker)
- ✅ Simpler debugging (no fetch event complexity)
- ✅ Reliable local-first experience

**Migration Path**: Service Worker → SharedWorker (tRPC only), Service Worker retained for background sync.

---

## Debugging & Diagnostics

### Debug Logging

Toggle debug logs via SharedWorker message:

```javascript
// From browser console (via SharedWorker client)
sharedWorkerClient.send({
  type: 'DEBUG_TOGGLE',
  enabled: true,
  categories: ['sync', 'session', 'db'] // optional, defaults to 'all'
});
```

### Checking IndexedDB

In DevTools → Application → IndexedDB → `til-stack-local` → `database`

Verify:
- Keys are named `sqlite-data-{userId}` (e.g., `sqlite-data-anonymous`, `sqlite-data-user_123`)
- Correct key is populated for current user
- No data leakage between keys

### Common Issues

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| User sees anonymous data after login | `currentUserId` not switched | Check SharedWorker logs |
| Data lost after logout | User cleared data during logout | Data preserved if "Cancel" selected |
| Missing server entries | Pull failed (offline or error) | Check sync logs |
| Entries not appearing | SharedWorker not connected | Refresh page, check console |

### Console Log Prefixes

- `[SharedWorker]` - SharedWorker operations
- `[Persistence]` - IndexedDB operations
- `[Sync]` - Server synchronization
- `[Session]` - User session state changes

---

## References

- **CLAUDE.md**: `/CLAUDE.md` (development guide for AI assistant)
- **Service Worker**: `/apps/web/src/service-worker.ts` (minimal, background sync only)
- **SharedWorker**: `/apps/web/src/shared-worker.ts` (local-first tRPC handler)
- **Backend Schema**: `/apps/api/src/db/schema.ts` (Drizzle tables)
- **Frontend Routes**: `/apps/web/src/routes/` (TanStack Router)
- **E2E Tests**: `/e2e/` (Playwright tests)

**Last Updated**: 2026-01-30
