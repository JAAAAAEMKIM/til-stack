# API Test Suites

This directory contains integration tests for the TIL Stack API.

## Prerequisites

Before running tests, start the API server with a test database:

```bash
PORT=3003 DATABASE_PATH=./data/test/test.db CORS_ORIGIN=http://localhost:3002 pnpm dev
```

Or create a test database first:
```bash
mkdir -p data/test
cp data/local.db data/test/test.db
DATABASE_PATH=./data/test/test.db pnpm db:migrate
```

## Test Suites

### 1. User Isolation Test (`user-isolation.test.ts`)

**Critical security test** - Verifies that different users cannot access each other's data.

```bash
pnpm tsx tests/user-isolation.test.ts
```

**Tests:**
- User A creates entry → User B cannot see it
- User B cannot delete User A's entries
- Same date, different users → separate entries
- Config (skipDays, templates) isolation
- Database-level verification

### 2. Multi-Device Sync Test (`multi-device-sync.test.ts`)

Tests same user on multiple devices with sync scenarios.

```bash
pnpm tsx tests/multi-device-sync.test.ts
```

**Tests:**
- Device A writes → Device B reads correctly
- Device B updates Device A's entry
- Concurrent edits (last-write-wins)
- Rapid sequential updates
- Multiple dates from multiple devices
- Delete from one device → verified on another

### 3. Offline/Online Complex Scenarios (`offline-sync-complex.test.ts`)

Tests edge cases for offline editing and sync conflicts.

```bash
pnpm tsx tests/offline-sync-complex.test.ts
```

**Scenarios:**
- Single device offline edit cycle
- Two devices, one offline, conflict resolution
- Stale edit sync behavior (documents current limitation)
- Bulk offline queue sync
- Delete while offline
- Config multi-device sync
- Extended offline period (7 days)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:3003/trpc` | API server URL |
| `DATABASE_PATH` | `./data/test/test.db` | Path to test database |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing secret |

## Run All Tests

```bash
# Start test server first
PORT=3003 DATABASE_PATH=./data/test/test.db pnpm dev &

# Run all tests
pnpm tsx tests/user-isolation.test.ts && \
pnpm tsx tests/multi-device-sync.test.ts && \
pnpm tsx tests/offline-sync-complex.test.ts
```

## Known Behaviors

### Last-Write-Wins

The server uses **arrival order** for conflict resolution, not logical timestamps. This means:
- If Device A edits at T1, goes offline
- Device B edits at T2 (later), syncs immediately
- Device A comes online and syncs at T3
- **Device A's edit wins** (even though logically older)

This is acceptable for single-user multi-device scenarios but documented in test results as a WARNING.

### User Isolation

All queries filter by `userId`:
- Authenticated users see only their data
- Anonymous users (no session) see only anonymous data (`userId = NULL`)
- Unique constraint on `(date, user_id)` allows same date for different users
