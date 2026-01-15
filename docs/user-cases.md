# User Case Specifications

## Overview

This document defines all user cases for the TIL Stack application, organized by user state (Guest vs Logged-in).

---

## Guest User (Not Logged In)

### UC-G1: View Entry List
**Description:** Guest user can view their locally stored entries on the home page.

**Preconditions:**
- User is not logged in
- Service worker is registered

**Steps:**
1. Navigate to home page (/)
2. View the list of entries (infinite scroll)

**Expected Results:**
- Entries are displayed in reverse chronological order
- Each entry shows date and content
- Data is loaded from local IndexedDB

**Test ID:** `guest-entry-list`

---

### UC-G2: Create New Entry
**Description:** Guest user can create a new TIL entry for today.

**Preconditions:**
- User is not logged in
- No entry exists for today's date

**Steps:**
1. Navigate to home page (/)
2. See the "New Entry" card for today
3. Enter content in the textarea
4. Click "Save" button

**Expected Results:**
- Entry is saved to local IndexedDB
- Entry appears in the list below
- Draft is cleared after save

**Test ID:** `guest-create-entry`

---

### UC-G3: Edit Existing Entry
**Description:** Guest user can edit an existing entry.

**Preconditions:**
- User is not logged in
- At least one entry exists

**Steps:**
1. Navigate to home page (/)
2. Click "Edit" (pencil icon) on an existing entry
3. Modify the content
4. Click "Save" button

**Expected Results:**
- Entry is updated in local IndexedDB
- Updated content is displayed
- `updatedAt` timestamp is updated

**Test ID:** `guest-edit-entry`

---

### UC-G4: Delete Entry
**Description:** Guest user can delete an existing entry.

**Preconditions:**
- User is not logged in
- At least one entry exists

**Steps:**
1. Navigate to home page (/)
2. Click "Edit" on an existing entry
3. Click "Delete" (trash icon) button
4. Confirm deletion

**Expected Results:**
- Entry is removed from local IndexedDB
- Entry disappears from the list

**Test ID:** `guest-delete-entry`

---

### UC-G5: Navigate Between Days
**Description:** Guest user can navigate to different dates.

**Preconditions:**
- User is not logged in

**Steps:**
1. Navigate to home page (/)
2. Click left/right arrow buttons to change date
3. View entry for selected date (or create new)

**Expected Results:**
- Date changes in the header
- Correct entry (or new entry form) is shown

**Test ID:** `guest-navigate-dates`

---

### UC-G6: View Monthly Calendar
**Description:** Guest user can view entries in monthly calendar view.

**Preconditions:**
- User is not logged in
- Some entries exist

**Steps:**
1. Navigate to monthly page (/monthly)
2. View calendar grid with entry indicators
3. Click on a date with entry

**Expected Results:**
- Calendar shows current month
- Dates with entries are highlighted
- Clicking date navigates to that entry

**Test ID:** `guest-monthly-view`

---

### UC-G7: Configure Skip Days
**Description:** Guest user can configure which days to skip when navigating.

**Preconditions:**
- User is not logged in

**Steps:**
1. Navigate to settings page (/config)
2. In "Days to Skip" section, toggle weekday buttons
3. Or add specific dates to skip

**Expected Results:**
- Skip days are saved to local IndexedDB
- Navigation skips configured days

**Test ID:** `guest-skip-days`

---

### UC-G8: Manage Templates
**Description:** Guest user can create and manage entry templates.

**Preconditions:**
- User is not logged in

**Steps:**
1. Navigate to settings page (/config)
2. In "Templates" section, click "New Template"
3. Enter template name and content
4. Save template
5. Optionally set as default

**Expected Results:**
- Template is saved to local IndexedDB
- Default template is used for new entries

**Test ID:** `guest-templates`

---

### UC-G9: View Account Section (Guest)
**Description:** Guest user sees login prompt in settings.

**Preconditions:**
- User is not logged in

**Steps:**
1. Navigate to settings page (/config)
2. View Account section at top

**Expected Results:**
- Shows "Sign in with Google" button
- Shows description about syncing across devices

**Test ID:** `guest-account-section`

---

### UC-G10: Webhooks Disabled
**Description:** Guest user cannot configure webhooks.

**Preconditions:**
- User is not logged in

**Steps:**
1. Navigate to settings page (/config)
2. View Webhooks section

**Expected Results:**
- Shows "Requires Login" badge
- Shows message to sign in
- No webhook configuration available

**Test ID:** `guest-webhooks-disabled`

---

### UC-G11: Navigate to Login Page
**Description:** Guest user can navigate to login page.

**Preconditions:**
- User is not logged in

**Steps:**
1. Navigate to settings page (/config)
2. Click "Sign in with Google" button

**Expected Results:**
- Redirects to login page (/login)
- Login page shows Google sign-in button

**Test ID:** `guest-login-navigation`

---

### UC-G12: Offline Functionality
**Description:** Guest user can use the app offline.

**Preconditions:**
- User is not logged in
- Service worker is registered
- Network is disconnected

**Steps:**
1. Disconnect from network
2. Navigate to home page
3. Create/edit entries
4. Navigate between pages

**Expected Results:**
- App continues to function
- Data is saved locally
- No network errors shown

**Test ID:** `guest-offline`

---

## Logged-In User

### UC-L1: Login with Google
**Description:** User can log in with Google OAuth.

**Preconditions:**
- User is not logged in
- Valid Google account available

**Steps:**
1. Navigate to login page (/login)
2. Click "Continue with Google"
3. Complete Google OAuth flow
4. Redirect back to app

**Expected Results:**
- User is authenticated
- Session cookie is set
- Initial sync occurs
- Redirect to home page

**Test ID:** `auth-login`

---

### UC-L2: View Account Section (Logged In)
**Description:** Logged-in user sees account info and sync status.

**Preconditions:**
- User is logged in

**Steps:**
1. Navigate to settings page (/config)
2. View Account section

**Expected Results:**
- Shows user ID (truncated)
- Shows sync status with icon
- Shows "Last synced: X ago" message
- Shows manual sync button
- Shows "Log out" button
- Shows "Delete Account" button

**Test ID:** `auth-account-section`

---

### UC-L3: Manual Sync
**Description:** Logged-in user can manually trigger sync.

**Preconditions:**
- User is logged in

**Steps:**
1. Navigate to settings page (/config)
2. Click sync button (refresh icon)
3. Wait for sync to complete

**Expected Results:**
- Sync icon spins during sync
- "Last synced" timestamp updates
- Local and server data are synchronized

**Test ID:** `auth-manual-sync`

---

### UC-L4: Auto Sync on Mutation
**Description:** Sync triggers automatically after data changes.

**Preconditions:**
- User is logged in

**Steps:**
1. Create or edit an entry
2. Wait 2+ seconds (debounce)

**Expected Results:**
- Sync occurs automatically
- "Last synced" timestamp updates

**Test ID:** `auth-auto-sync`

---

### UC-L5: Configure Webhooks
**Description:** Logged-in user can configure webhook notifications.

**Preconditions:**
- User is logged in

**Steps:**
1. Navigate to settings page (/config)
2. In Webhooks section, click "New Webhook"
3. Enter webhook details (URL, time, days, etc.)
4. Save webhook
5. Optionally test webhook

**Expected Results:**
- Webhook is saved to server
- Webhook appears in list
- Test sends notification to configured URL

**Test ID:** `auth-webhooks`

---

### UC-L6: Logout
**Description:** Logged-in user can log out.

**Preconditions:**
- User is logged in

**Steps:**
1. Navigate to settings page (/config)
2. Click "Log out" button

**Expected Results:**
- Session is cleared
- Service worker notified (USER_LOGGED_OUT)
- Account section shows login button
- Webhooks section shows "Requires Login"
- Local data remains intact

**Test ID:** `auth-logout`

---

### UC-L7: Delete Account
**Description:** Logged-in user can delete their account.

**Preconditions:**
- User is logged in

**Steps:**
1. Navigate to settings page (/config)
2. Click "Delete Account" button
3. Confirm deletion in dialog

**Expected Results:**
- Server deletes user and all associated data
- Session is cleared
- User is logged out
- Local data remains (as guest data)

**Test ID:** `auth-delete-account`

---

### UC-L8: Data Persistence Across Login/Logout
**Description:** Local data persists regardless of auth state.

**Preconditions:**
- Some entries exist locally

**Steps:**
1. As guest, create entries
2. Log in
3. Verify entries still visible
4. Log out
5. Verify entries still visible

**Expected Results:**
- Local data is never deleted
- Data remains accessible in both states

**Test ID:** `auth-data-persistence`

---

### UC-L9: Sync Conflict Resolution
**Description:** Conflicts are resolved using last-write-wins.

**Preconditions:**
- User is logged in
- Same entry exists locally and on server with different content

**Steps:**
1. Edit entry locally
2. Edit same entry on server (via another device)
3. Trigger sync

**Expected Results:**
- Entry with newer `updatedAt` timestamp wins
- Both local and server have consistent data

**Test ID:** `auth-sync-conflict`

---

## Edge Cases

### UC-E1: Service Worker Not Ready
**Description:** App handles case when service worker isn't registered yet.

**Steps:**
1. Open app in new browser (no SW registered)
2. Attempt to use app

**Expected Results:**
- App functions after SW registers
- No errors during initial load

**Test ID:** `edge-sw-not-ready`

---

### UC-E2: Draft Auto-Save
**Description:** Drafts are automatically saved to prevent data loss.

**Steps:**
1. Start typing in entry editor
2. Close browser tab without saving
3. Reopen app

**Expected Results:**
- Draft content is restored
- User can continue editing

**Test ID:** `edge-draft-autosave`

---

### UC-E3: Theme Persistence
**Description:** Theme preference persists across sessions.

**Steps:**
1. Change theme in settings
2. Close and reopen app

**Expected Results:**
- Theme setting is remembered
- Correct theme is applied on load

**Test ID:** `edge-theme-persistence`

---

## Test Matrix

| Test ID | Guest | Auth | Priority |
|---------|-------|------|----------|
| guest-entry-list | ✓ | - | P0 |
| guest-create-entry | ✓ | - | P0 |
| guest-edit-entry | ✓ | - | P0 |
| guest-delete-entry | ✓ | - | P1 |
| guest-navigate-dates | ✓ | - | P1 |
| guest-monthly-view | ✓ | - | P1 |
| guest-skip-days | ✓ | - | P2 |
| guest-templates | ✓ | - | P2 |
| guest-account-section | ✓ | - | P1 |
| guest-webhooks-disabled | ✓ | - | P1 |
| guest-login-navigation | ✓ | - | P1 |
| guest-offline | ✓ | - | P2 |
| auth-login | - | ✓ | P0 |
| auth-account-section | - | ✓ | P0 |
| auth-manual-sync | - | ✓ | P1 |
| auth-auto-sync | - | ✓ | P1 |
| auth-webhooks | - | ✓ | P2 |
| auth-logout | - | ✓ | P0 |
| auth-delete-account | - | ✓ | P2 |
| auth-data-persistence | - | ✓ | P1 |
| auth-sync-conflict | - | ✓ | P2 |
| edge-sw-not-ready | ✓ | - | P2 |
| edge-draft-autosave | ✓ | ✓ | P2 |
| edge-theme-persistence | ✓ | ✓ | P3 |

**Priority Legend:**
- P0: Critical - Must pass for release
- P1: High - Important functionality
- P2: Medium - Nice to have
- P3: Low - Edge cases
