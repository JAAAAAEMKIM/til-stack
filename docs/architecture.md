# TIL Stack Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TIL Stack App                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         React Frontend                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   Editor    │  │  Monthly    │  │  Settings   │  │   Login     │  │   │
│  │  │   (/)       │  │  (/monthly) │  │  (/config)  │  │  (/login)   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │                           │                                           │   │
│  │                    ┌──────▼──────┐                                    │   │
│  │                    │ tRPC Client │                                    │   │
│  │                    └──────┬──────┘                                    │   │
│  └───────────────────────────┼───────────────────────────────────────────┘   │
│                              │                                               │
│                              │ /trpc/* requests                              │
│                              ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      Service Worker (Local-First)                     │   │
│  │                                                                       │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │  Route Decision                                              │    │   │
│  │   │  ├─ auth.*     → Pass to Network (Server handles)           │    │   │
│  │   │  ├─ webhooks.* → Pass to Network (Server handles)           │    │   │
│  │   │  └─ entries.*  → Handle Locally (sql.js)                    │    │   │
│  │   │  └─ config.*   → Handle Locally (sql.js)                    │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │              sql.js (SQLite WASM)                            │    │   │
│  │   │              ┌─────────────────────────────────────────┐     │    │   │
│  │   │              │  Tables:                                 │     │    │   │
│  │   │              │  - entries (id, date, content, ...)     │     │    │   │
│  │   │              │  - skip_days (id, type, value, ...)     │     │    │   │
│  │   │              │  - templates (id, name, content, ...)   │     │    │   │
│  │   │              └─────────────────────────────────────────┘     │    │   │
│  │   └───────────────────────────┬─────────────────────────────────┘    │   │
│  │                               │                                       │   │
│  │                               ▼                                       │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │              IndexedDB (Persistence)                         │    │   │
│  │   │              - Stores sql.js database as Uint8Array         │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend (API)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         Hono Server                                   │   │
│  │                                                                       │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │  Routes                                                      │    │   │
│  │   │  ├─ /trpc/*  → tRPC Handler                                 │    │   │
│  │   │  ├─ /auth/*  → OAuth Flow (Google)                          │    │   │
│  │   │  └─ /health  → Health Check                                 │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │  tRPC Routers                                                │    │   │
│  │   │  ├─ auth     (me, logout, deleteAccount, migrateData)       │    │   │
│  │   │  ├─ entries  (upsert, list, getByDate, delete, ...)         │    │   │
│  │   │  ├─ config   (getSkipDays, getTemplates, ...)               │    │   │
│  │   │  └─ webhooks (list, create, update, delete, test)           │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │              SQLite (better-sqlite3)                         │    │   │
│  │   │              ┌─────────────────────────────────────────┐     │    │   │
│  │   │              │  Tables:                                 │     │    │   │
│  │   │              │  - users (id, google_id)                │     │    │   │
│  │   │              │  - entries (id, date, content, user_id) │     │    │   │
│  │   │              │  - skip_days (user_id, ...)             │     │    │   │
│  │   │              │  - templates (user_id, ...)             │     │    │   │
│  │   │              │  - webhooks (user_id, ...)              │     │    │   │
│  │   │              └─────────────────────────────────────────┘     │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Guest User (Not Logged In)

```
┌──────────┐     ┌──────────────┐     ┌─────────┐     ┌───────────┐
│  React   │────▶│   Service    │────▶│  sql.js │────▶│ IndexedDB │
│   App    │     │   Worker     │     │  (WASM) │     │           │
└──────────┘     └──────────────┘     └─────────┘     └───────────┘
                        │
                        │ auth.*, webhooks.*
                        ▼
                 ┌──────────────┐
                 │    Server    │  (Only for auth & webhooks)
                 └──────────────┘
```

**Characteristics:**
- All entries/config data stored locally in IndexedDB
- Works completely offline
- Webhooks disabled (requires login)
- No server sync

### 2. Logged-In User

```
┌──────────┐     ┌──────────────┐     ┌─────────┐     ┌───────────┐
│  React   │────▶│   Service    │────▶│  sql.js │────▶│ IndexedDB │
│   App    │     │   Worker     │     │  (WASM) │     │ (Primary) │
└──────────┘     └──────────────┘     └─────────┘     └───────────┘
                        │                   │
                        │                   │ Bidirectional Sync
                        │                   ▼
                        │            ┌──────────────┐
                        └───────────▶│    Server    │
                          auth.*     │   (Backup)   │
                          webhooks.* └──────────────┘
```

**Characteristics:**
- Local IndexedDB remains primary data source
- Background sync to server (last-write-wins)
- Webhooks enabled
- Works offline, syncs when online

### 3. Sync Flow (Last-Write-Wins)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Sync Process                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Trigger Sync                                                 │
│     ├─ On app load (if logged in)                               │
│     ├─ After mutation (debounced 2s)                            │
│     └─ Manual trigger (sync button)                             │
│                                                                  │
│  2. Fetch Data                                                   │
│     ├─ Get all local entries from IndexedDB                     │
│     └─ Get all server entries via tRPC                          │
│                                                                  │
│  3. Compare by Date                                              │
│     For each date:                                               │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ Local Only?    → Push to Server                      │     │
│     │ Server Only?   → Pull to Local                       │     │
│     │ Both Exist?    → Compare updatedAt                   │     │
│     │   └─ Local newer?  → Push to Server                  │     │
│     │   └─ Server newer? → Pull to Local                   │     │
│     │   └─ Same?         → Skip (already synced)           │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                  │
│  4. Update Last Synced Timestamp                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Google OAuth Flow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User clicks "Sign in with Google"                           │
│                    │                                             │
│                    ▼                                             │
│  2. Redirect to /trpc/auth.getGoogleAuthUrl                     │
│                    │                                             │
│                    ▼                                             │
│  3. Google OAuth consent screen                                  │
│                    │                                             │
│                    ▼                                             │
│  4. Redirect to /auth/callback?code=xxx                         │
│                    │                                             │
│                    ▼                                             │
│  5. Exchange code for tokens (server-side)                      │
│                    │                                             │
│                    ▼                                             │
│  6. Create/find user, generate JWT                              │
│                    │                                             │
│                    ▼                                             │
│  7. Set httpOnly cookie, redirect to app                        │
│                    │                                             │
│                    ▼                                             │
│  8. Initial sync (push local data to server)                    │
│                    │                                             │
│                    ▼                                             │
│  9. Notify Service Worker (USER_LOGGED_IN)                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TanStack Router, TanStack Query |
| Styling | Tailwind CSS, shadcn/ui |
| API Client | tRPC |
| Offline Storage | sql.js (SQLite WASM), IndexedDB |
| Service Worker | Native SW API |
| Backend | Hono, tRPC |
| Database | SQLite (better-sqlite3), Drizzle ORM |
| Auth | Google OAuth, JWT (jose) |
| Build | Rspack, pnpm monorepo |
