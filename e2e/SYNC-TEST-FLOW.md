# Sync & Authentication E2E Test Flow

This document defines comprehensive test scenarios for validating local-first sync, authentication, and multi-device scenarios.

## Prerequisites

- Two isolated browser environments (A and B) - can use incognito/private windows or different browser profiles
- Dev server running on http://localhost:3000
- Backend API running on http://localhost:3001

## Test Environment Setup

### Environment A
- Primary testing environment
- Used for initial login, logout flows

### Environment B
- Secondary isolated environment (incognito mode or separate profile)
- Used for simulating "another device" or "fresh login"

---

## Test Scenarios

### Test 1: Anonymous Entry Creation
**Goal**: Verify anonymous users can create and view entries without login

**Steps**:
1. Open app in Environment A (not logged in)
2. Navigate to home page (/)
3. Create an entry for today's date with content: "Anonymous Test Entry - [timestamp]"
4. Verify entry appears in the list
5. Refresh page
6. Verify entry persists after refresh (stored in IndexedDB)

**Expected Result**: Entry is created and persists across page refreshes without login

---

### Test 2: New User Login - Anonymous Data Migration
**Goal**: Verify anonymous data is migrated to new user account on first login

**Steps**:
1. From Test 1, ensure Environment A has anonymous entries
2. Click Login button
3. Complete Google OAuth flow with a NEW account (first time login)
4. Wait for sync to complete
5. Verify:
   - Anonymous entries now appear under the logged-in user
   - Check browser DevTools IndexedDB: `sqlite-data-anonymous` should be empty/deleted
   - Check browser DevTools IndexedDB: `sqlite-data-[userId]` should contain data

**Expected Result**:
- Anonymous data is migrated to user's namespace
- Anonymous data storage is cleared
- Entries display correctly after login

---

### Test 3: Cross-Device Sync - Existing User Login
**Goal**: Verify entries sync from server when logging in on a new device

**Steps**:
1. From Test 2, user is logged in on Environment A
2. Open Environment B (incognito window or fresh profile)
3. Navigate to app (/)
4. Verify no entries exist (fresh environment)
5. Login with the SAME Google account used in Test 2
6. Wait for sync to complete
7. Verify:
   - All entries from Environment A are now visible in Environment B
   - Entry content matches exactly

**Expected Result**: Server-synced entries appear in the new environment

---

### Test 4: Bi-directional Deletion Sync
**Goal**: Verify deletions sync correctly between devices

**Steps**:
1. From Test 3, both environments are logged in with same account
2. In Environment A:
   - Create Entry A: "Entry A - Delete Test - [timestamp]"
   - Create Entry B: "Entry B - Delete Test - [timestamp]"
3. Refresh both environments to ensure sync
4. In Environment A: Delete Entry A
5. In Environment B: Delete Entry B
6. Refresh Environment A
7. Verify Environment A shows no entries (both deleted)
8. Refresh Environment B
9. Verify Environment B shows no entries (both deleted)

**Expected Result**: Deletions propagate bi-directionally via server sync

---

### Test 5: Logout Clears User Data (Shows Empty)
**Goal**: Verify logout clears displayed entries and shows anonymous state

**Steps**:
1. From Test 4, Environment A is logged in
2. Create new entry: "Pre-Logout Entry - [timestamp]"
3. Verify entry is visible
4. Click Logout
5. Wait for logout to complete
6. Verify:
   - No entries are displayed (empty list)
   - IndexedDB `sqlite-data-[userId]` is NOT cleared (data preserved for re-login)
   - User sees anonymous state

**Expected Result**: Logged out user sees empty entry list (anonymous namespace)

---

### Test 6: Anonymous Entry Creation After Logout
**Goal**: Verify users can create anonymous entries after logging out

**Steps**:
1. From Test 5, user is logged out in Environment A
2. Create new anonymous entry: "Post-Logout Anonymous Entry - [timestamp]"
3. Verify entry appears
4. Refresh page
5. Verify entry persists

**Expected Result**: Anonymous entries work normally after logout

---

### Test 7: Re-login - User Entries Restored, Anonymous NOT Merged
**Goal**: Verify re-login restores user entries WITHOUT merging new anonymous data

**Steps**:
1. From Test 6, Environment A has anonymous entries created after logout
2. Login with the SAME Google account (EXISTING user, not new)
3. Wait for sync to complete
4. Verify:
   - User's server entries are displayed (NOT anonymous entries)
   - Anonymous entries created in Test 6 are NOT shown
   - Anonymous entries remain in IndexedDB `sqlite-data-anonymous` (preserved for logout)

**Expected Result**:
- Re-login shows ONLY user's server-synced entries
- Anonymous entries are NOT merged (only new users get migration)
- Anonymous data is preserved in separate namespace

---

### Test 8: Logout Shows Previous Anonymous Entries
**Goal**: Verify logout restores previously created anonymous entries

**Steps**:
1. From Test 7, user is logged in
2. Logout
3. Verify anonymous entries from Test 6 are displayed again

**Expected Result**: Logout returns user to their anonymous session with previous anonymous data

---

### Test 9: Offline Editing - Single Device
**Goal**: Verify offline edits are queued and synced when back online

**Steps**:
1. Login in Environment A
2. Create baseline entry: "Baseline Entry - [timestamp]"
3. Open DevTools > Network tab > Offline mode
4. Create offline entries:
   - Entry O1: "Offline Entry 1 - [timestamp]"
   - Entry O2: "Offline Entry 2 - [timestamp]"
5. Edit baseline entry: "Baseline Entry - EDITED OFFLINE - [timestamp]"
6. Verify entries appear locally (in IndexedDB)
7. Disable offline mode (go back online)
8. Wait for background sync OR refresh page
9. Verify all entries sync to server

**Expected Result**: Offline entries are persisted locally and sync when online

---

### Test 10: Offline Editing - Multi-Device
**Goal**: Verify offline edits from multiple devices eventually merge

**Steps**:
1. Both environments logged in with same account
2. In Environment A:
   - Enable offline mode
   - Create: "A-Offline-Entry - [timestamp]"
   - Edit existing entry: "Common Entry - EDITED BY A"
3. In Environment B:
   - Create: "B-Online-Entry - [timestamp]"
   - Edit same existing entry: "Common Entry - EDITED BY B"
4. In Environment A:
   - Disable offline mode
   - Refresh to trigger sync
5. Verify Environment A shows:
   - "A-Offline-Entry" (pushed from local)
   - "B-Online-Entry" (pulled from server)
   - "Common Entry - EDITED BY B" (server wins - last write wins)

**Expected Result**: Both devices' entries merge with last-write-wins for conflicts

---

### Test 11: Cross-Device Sync After Offline
**Goal**: Verify offline changes appear on other devices after sync

**Steps**:
1. From Test 10
2. Refresh Environment B
3. Verify Environment B shows:
   - "A-Offline-Entry" (synced from Environment A via server)
   - "B-Online-Entry" (created locally)
   - Both environments have identical entry lists

**Expected Result**: Full bidirectional sync achieved

---

### Test 12: Final State Verification
**Goal**: Verify data integrity across all scenarios

**Steps**:
1. Logout from Environment A
2. Verify anonymous entries (if any) are displayed
3. Login again
4. Verify user entries are displayed correctly
5. Logout from Environment B
6. Close both environments

**Expected Result**: All data operations complete without data loss or corruption

---

## Technical Verification Points

### IndexedDB Structure
```
til-stack-local
  └── database
      ├── sqlite-data-anonymous   // Anonymous user data
      └── sqlite-data-[userId]    // Logged-in user data
```

### Service Worker Messages
- `USER_LOGIN`: Triggers login handling with migration/merge logic
- `USER_LOGGED_OUT`: Switches to anonymous namespace
- `SYNC_NOW`: Triggers full bidirectional sync
- `CHECK_PENDING_SYNC`: Returns pending operation count

### Console Log Indicators
- `[SW] User login: ...` - Login handling started
- `[SW] Pull complete: X entries` - Server pull completed
- `[SW] Push complete: X entries` - Server push completed
- `[SW] Migrated anonymous data` - Anonymous → User migration
- `[SW] Merged X anonymous entries` - Anonymous → User merge (returning user)

---

## Automated E2E Test Mapping

| Manual Test | E2E Test File | Test Name |
|------------|---------------|-----------|
| Test 1 | `sync-auth.spec.ts` | `anonymous entry creation` |
| Test 2 | `sync-auth.spec.ts` | `new user login migrates anonymous data` |
| Test 3 | `sync-auth.spec.ts` | `cross-device sync on login` |
| Test 4 | `sync-auth.spec.ts` | `bidirectional deletion sync` |
| Test 5-8 | `sync-auth.spec.ts` | `logout and re-login flow` |
| Test 9-11 | `sync-auth.spec.ts` | `offline editing and sync` |
| Test 12 | `sync-auth.spec.ts` | `final state verification` |
