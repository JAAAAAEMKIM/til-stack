# Test Alignment Verification

This document maps user cases to their corresponding E2E tests.

## Guest User Tests (`e2e/guest.spec.ts`)

| User Case | Test ID | Test Function | Verified |
|-----------|---------|---------------|----------|
| UC-G1 | `guest-entry-list` | `can view entry list on home page` | ✅ |
| UC-G2 | `guest-create-entry` | `can create a new entry for today` | ✅ |
| UC-G3 | `guest-edit-entry` | `can edit an existing entry` | ✅ |
| UC-G4 | `guest-delete-entry` | `can delete an existing entry` | ✅ |
| UC-G5 | `guest-navigate-dates` | `can navigate between days` | ✅ |
| UC-G6 | `guest-monthly-view` | `can view monthly calendar` | ✅ |
| UC-G7 | `guest-skip-days` | `can configure skip days` | ✅ |
| UC-G8 | `guest-templates` | `can manage templates` | ✅ |
| UC-G9 | `guest-account-section` | `sees login prompt when not logged in` | ✅ |
| UC-G10 | `guest-webhooks-disabled` | `webhooks require login` | ✅ |
| UC-G11 | `guest-login-navigation` | `can navigate to login page` | ✅ |
| UC-G12 | `guest-offline` | `app works offline` | ✅ |
| UC-E1 | `edge-sw-not-ready` | `handles service worker not ready` | ✅ |
| UC-E2 | `edge-draft-autosave` | `auto-saves drafts` | ✅ |
| UC-E3 | `edge-theme-persistence` | `persists theme preference` | ✅ |

## Logged-In User Tests (`e2e/auth.spec.ts`)

| User Case | Test ID | Test Function | Verified |
|-----------|---------|---------------|----------|
| UC-L1 | `auth-login` | `can initiate Google OAuth login` | ✅ |
| UC-L2 | `auth-account-section` | `shows account info when logged in` | ✅ |
| UC-L3 | `auth-manual-sync` | `can trigger manual sync` | ✅ |
| UC-L4 | `auth-auto-sync` | `triggers sync after mutation` | ✅ |
| UC-L5 | `auth-webhooks` | `can configure webhooks when logged in` | ✅ |
| UC-L6 | `auth-logout` | `can log out` | ✅ |
| UC-L7 | `auth-delete-account` | `can delete account` | ✅ |
| UC-L8 | `auth-data-persistence` | `local data persists across auth changes` | ✅ |
| UC-L9 | `auth-sync-conflict` | `resolves conflicts with last-write-wins` | ✅ |

## UI Element Selectors Reference

Based on the actual implementation:

### Home Page (`/`)
- **Save Button**: `button` with `Save` text and Save icon
- **Edit Button**: `button` with Pencil icon (no text)
- **Delete Button**: `button` with Trash2 icon, `variant="destructive"`
- **Textarea**: Standard textarea with `placeholder="# Today I learned..."`
- **Date Navigation**: ChevronLeft/ChevronRight buttons
- **Date Display**: `text-lg font-semibold` showing YYYY-MM-DD format

### Settings Page (`/config`)
- **Account Section**: Card with User icon and "Account" title
- **Sign In Button**: `button` with GoogleIcon and "Sign in with Google" text
- **Log Out Button**: `button` with LogOut icon and "Log out" text
- **Delete Account Button**: `button` with Trash2 icon and "Delete Account" text, `variant="destructive"`
- **Sync Status**: Shows Cloud/CloudOff/RefreshCw icons with "Last synced:" message
- **Manual Sync Button**: `button` with RefreshCw icon
- **Webhooks Section**: Card with Webhook icon, "Requires Login" badge when not logged in
- **New Webhook Button**: `button` with Plus icon and "New Webhook" text
- **Skip Days Buttons**: Buttons for Sun/Mon/Tue/Wed/Thu/Fri/Sat
- **Templates Section**: Card with "Templates" title
- **New Template Button**: `button` with Plus icon and "New Template" text
- **Theme Buttons**: System/Light/Dark buttons with Monitor/Sun/Moon icons

## Running Tests

```bash
# Run all tests
pnpm test

# Run guest tests only
pnpm test:guest

# Run auth tests only
pnpm test:auth

# Run tests with UI
pnpm test:ui

# Run tests in headed mode (see browser)
pnpm test:headed
```

## Notes

1. **IndexedDB Clearing**: Tests clear IndexedDB before each test for clean state
2. **Service Worker**: Tests wait for service worker to be ready
3. **Mock Auth**: Auth tests use route mocking to simulate login state
4. **Offline Testing**: Uses `context.setOffline(true)` to simulate offline mode
5. **Dialog Handling**: Delete confirmation uses `page.on("dialog")` handler
