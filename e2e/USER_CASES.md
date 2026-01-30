# User Case Specifications

User cases for TIL Stack, organized by user state. Each case maps to E2E tests.

---

## Guest User (Not Logged In)

### UC-G1: View Entry List
**Test**: `guest-entry-list` in `guest.spec.ts`

View locally stored entries on home page with infinite scroll.

### UC-G2: Create New Entry
**Test**: `guest-create-entry` in `guest.spec.ts`

Create a new TIL entry for today. Entry saves to local storage and appears in list.

### UC-G3: Edit Existing Entry
**Test**: `guest-edit-entry` in `guest.spec.ts`

Edit an existing entry. Content updates with new timestamp.

### UC-G4: Delete Entry
**Test**: `guest-delete-entry` in `guest.spec.ts`

Delete an entry with confirmation dialog.

### UC-G5: Navigate Between Days
**Test**: `guest-navigate-dates` in `guest.spec.ts`

Navigate to different dates using arrow buttons. View/create entry for selected date.

### UC-G6: View Monthly Calendar
**Test**: `guest-monthly-view` in `guest.spec.ts`

Calendar view showing entry indicators. Click date to navigate.

### UC-G7: Configure Skip Days
**Test**: `guest-skip-days` in `guest.spec.ts`

Configure weekdays and specific dates to skip in navigation.

### UC-G8: Manage Templates
**Test**: `guest-templates` in `guest.spec.ts`

CRUD templates with default template selection.

### UC-G9: View Account Section (Guest)
**Test**: `guest-account-section` in `guest.spec.ts`

Guest sees login prompt in settings.

### UC-G10: Webhooks Disabled
**Test**: `guest-webhooks-disabled` in `guest.spec.ts`

Webhooks require login - shows "Requires Login" badge.

### UC-G11: Navigate to Login
**Test**: `guest-login-navigation` in `guest.spec.ts`

Click login button to start OAuth flow.

### UC-G12: Offline Functionality
**Test**: `guest-offline` in `guest.spec.ts`

App works offline - create/edit entries without network.

---

## Logged-In User

### UC-L1: Login with Google
**Test**: `auth-login` in `auth.spec.ts`, `login-flow.spec.ts`

Complete Google OAuth flow, initial sync occurs.

### UC-L2: View Account Section (Logged In)
**Test**: `auth-account-section` in `auth.spec.ts`

Shows user ID, sync status, last synced time, logout/delete buttons.

### UC-L3: Manual Sync
**Test**: `auth-manual-sync` in `auth.spec.ts`

Manually trigger sync with server.

### UC-L4: Auto Sync on Mutation
**Test**: `auth-auto-sync` in `auth.spec.ts`

Sync triggers automatically after data changes (debounced).

### UC-L5: Configure Webhooks
**Test**: `auth-webhooks` in `auth.spec.ts`

CRUD webhooks with cron scheduling (max 5).

### UC-L6: Logout
**Test**: `auth-logout` in `auth.spec.ts`

Clear session, return to anonymous namespace.

### UC-L7: Delete Account
**Test**: `auth-delete-account` in `auth.spec.ts`

Delete user account and all server data.

### UC-L8: Data Persistence
**Test**: `auth-data-persistence` in `auth.spec.ts`

Local data persists across auth state changes.

### UC-L9: Sync Conflict Resolution
**Test**: `auth-sync-conflict` in `auth.spec.ts`

Conflicts resolved with last-write-wins based on timestamp.

---

## Edge Cases

### UC-E1: SharedWorker Not Ready
**Test**: `edge-sw-not-ready` in `guest.spec.ts`

App handles initial load before worker is ready.

### UC-E2: Draft Auto-Save
**Test**: `edge-draft-autosave` in `guest.spec.ts`

Drafts auto-save to localStorage, restore on return.

### UC-E3: Theme Persistence
**Test**: `edge-theme-persistence` in `guest.spec.ts`

Theme preference persists across sessions.

---

## Test Matrix

| Test ID | File | Priority |
|---------|------|----------|
| guest-entry-list | guest.spec.ts | P0 |
| guest-create-entry | guest.spec.ts | P0 |
| guest-edit-entry | guest.spec.ts | P0 |
| guest-delete-entry | guest.spec.ts | P1 |
| guest-navigate-dates | guest.spec.ts | P1 |
| guest-monthly-view | guest.spec.ts | P1 |
| guest-skip-days | guest.spec.ts | P2 |
| guest-templates | guest.spec.ts | P2 |
| guest-account-section | guest.spec.ts | P1 |
| guest-webhooks-disabled | guest.spec.ts | P1 |
| guest-login-navigation | guest.spec.ts | P1 |
| guest-offline | guest.spec.ts | P2 |
| auth-login | auth.spec.ts | P0 |
| auth-account-section | auth.spec.ts | P0 |
| auth-manual-sync | auth.spec.ts | P1 |
| auth-auto-sync | auth.spec.ts | P1 |
| auth-webhooks | auth.spec.ts | P2 |
| auth-logout | auth.spec.ts | P0 |
| auth-delete-account | auth.spec.ts | P2 |
| auth-data-persistence | auth.spec.ts | P1 |
| auth-sync-conflict | auth.spec.ts | P2 |
| edge-sw-not-ready | guest.spec.ts | P2 |
| edge-draft-autosave | guest.spec.ts | P2 |
| edge-theme-persistence | guest.spec.ts | P3 |

**Priority**: P0=Critical, P1=High, P2=Medium, P3=Low
