# E2E Testing Guide

Comprehensive E2E test documentation for TIL Stack.

---

## Test Files

| File | Purpose |
|------|---------|
| `guest.spec.ts` | Guest user functionality (CRUD, navigation, settings) |
| `auth.spec.ts` | Authentication and sync features |
| `login-flow.spec.ts` | Login flow edge cases and bug fixes |
| `sync-auth.spec.ts` | Sync + auth integration scenarios |
| `sync-pagination.spec.ts` | Large dataset sync handling |
| `multi-user-switching.spec.ts` | User switching and isolation |
| `multi-device-sync.spec.ts` | Cross-device sync scenarios |
| `user-isolation.spec.ts` | Data isolation between users |
| `backend-sync.spec.ts` | Backend DB verification |
| `debug-sync.spec.ts` | Debug/trace utilities |

---

## Running Tests

```bash
# Run all tests
pnpm test:e2e

# Run specific file
pnpm test:e2e guest.spec.ts

# Run with UI (headed mode)
pnpm test:e2e --headed

# Run with Playwright UI
pnpm test:e2e --ui

# Debug mode
pnpm test:e2e --debug
```

---

## Test Environment

### Prerequisites
- Dev servers running on `localhost:3070` (or configured E2E_BASE_URL)
- Backend API available for auth/sync tests

### Environment Variables
```bash
E2E_BASE_URL=http://localhost:3070  # Override default URL
```

---

## Sync & Auth Test Scenarios

### Scenario 1: Anonymous Entry Creation
**Goal**: Verify anonymous users can create entries without login

1. Open app (not logged in)
2. Create entry for today
3. Verify entry persists after refresh

### Scenario 2: New User Login - Data Migration
**Goal**: Verify anonymous data migrates to new account

1. Create anonymous entries
2. Login with NEW Google account
3. Verify anonymous entries now belong to user
4. Verify `sqlite-data-anonymous` is cleared

### Scenario 3: Cross-Device Sync
**Goal**: Verify entries sync from server on new device

1. Login on Device A, create entries
2. Login on Device B with SAME account
3. Verify Device B shows Device A's entries

### Scenario 4: Bidirectional Deletion Sync
**Goal**: Verify deletions propagate between devices

1. Both devices logged in
2. Device A deletes Entry A
3. Device B deletes Entry B
4. Both devices should show neither entry

### Scenario 5: Logout Behavior
**Goal**: Verify logout returns to anonymous namespace

1. Login and create entries
2. Logout
3. Verify no entries displayed (anonymous namespace)
4. User data preserved in IndexedDB for re-login

### Scenario 6: Returning User Login
**Goal**: Verify re-login restores user data, doesn't merge anonymous

1. Logout
2. Create anonymous entries
3. Re-login with SAME account
4. Verify ONLY server-synced data shown (not anonymous)
5. Anonymous data preserved separately

### Scenario 7: Offline Editing
**Goal**: Verify offline edits sync when back online

1. Login
2. Go offline
3. Create/edit entries
4. Go back online
5. Verify entries sync to server

---

## UI Element Selectors

### Home Page (`/`)
- **Save Button**: `button` with Save icon
- **Edit Button**: `button` with Pencil icon
- **Delete Button**: `button` with Trash2 icon, `variant="destructive"`
- **Textarea**: `placeholder="# Today I learned..."`
- **Date Navigation**: ChevronLeft/ChevronRight buttons

### Settings Page (`/config`)
- **Sign In Button**: "Sign in with Google" text
- **Log Out Button**: "Log out" text
- **Delete Account Button**: "Delete Account" text
- **Sync Button**: RefreshCw icon button
- **New Webhook Button**: "New Webhook" text
- **New Template Button**: "New Template" text
- **Theme Buttons**: System/Light/Dark

### Dev Login (Test Only)
- **Dev Login Input**: `placeholder="e.g., test-user-123"`
- **Dev Login Button**: "Dev Login" text

---

## Test Utilities

### Clear IndexedDB
```typescript
await page.evaluate(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
});
```

### Wait for SharedWorker
```typescript
await page.waitForFunction(() => {
  return (window as any).__sharedWorkerReady === true;
});
```

### Mock Network Offline
```typescript
await context.setOffline(true);
// ... do offline operations
await context.setOffline(false);
```

### Dev Login Helper
```typescript
async function devLogin(page: Page, userId: string) {
  await page.goto("/config");
  await page.getByPlaceholder("e.g., test-user-123").fill(userId);
  await page.getByRole("button", { name: "Dev Login" }).click();
  await page.waitForURL("/");
}
```

---

## Debugging Tests

### Console Logs
```typescript
page.on("console", (msg) => {
  console.log(`[Browser] ${msg.type()}: ${msg.text()}`);
});
```

### Network Requests
```typescript
page.on("request", (req) => {
  console.log(`[Network] ${req.method()} ${req.url()}`);
});
```

### Screenshots on Failure
Playwright automatically captures screenshots on test failure. Find them in `test-results/`.

### Trace Viewer
```bash
pnpm playwright show-trace test-results/.../trace.zip
```

---

## Notes

1. **IndexedDB Clearing**: Tests clear IndexedDB before each test for clean state
2. **SharedWorker**: Tests wait for SharedWorker to be ready
3. **Dev Login**: Uses dev login functionality (non-OAuth) for testing
4. **Offline Testing**: Uses `context.setOffline()` to simulate offline mode
5. **Dialog Handling**: Delete confirmation uses `page.on("dialog")` handler
