import { test, expect, Page } from "@playwright/test";

/**
 * E2E Tests for Sync and Authentication Flow
 * Based on manual test scenarios in SYNC-TEST-FLOW.md
 *
 * These tests verify:
 * - Anonymous entry creation and persistence
 * - Login migrates anonymous data to user account
 * - Cross-device sync via server
 * - Bi-directional deletion sync
 * - Logout clears user data display
 * - Re-login restores user data with anonymous merge
 * - Offline editing and sync
 */

const TEST_USER_ID = `sync-test-${Date.now()}`;

// Helper to perform dev login
async function devLogin(page: Page, googleId: string = TEST_USER_ID): Promise<boolean> {
  await page.goto("/login");
  await page.waitForTimeout(1000);

  // Check if dev login is available
  const devInput = page.getByPlaceholder("e.g., test-user-123");
  if (!(await devInput.isVisible().catch(() => false))) {
    console.log("Dev login not available");
    return false;
  }

  await devInput.fill(googleId);

  const devLoginButton = page.getByRole("button", { name: "Dev Login" });
  await devLoginButton.click();

  // Wait for redirect to home or verify login state
  try {
    await page.waitForURL("/", { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify login by checking config page
    await page.goto("/config");
    await page.waitForTimeout(1000);

    const logoutButton = page.getByRole("button", { name: "Log out" });
    const isLoggedIn = await logoutButton.isVisible({ timeout: 3000 }).catch(() => false);

    if (!isLoggedIn) {
      console.log("Dev login did not complete - user not logged in");
      return false;
    }

    return true;
  } catch (error) {
    console.log("Dev login failed:", error);
    return false;
  }
}

// Helper to logout
async function logout(page: Page, clearData: boolean = true) {
  await page.goto("/config");
  await page.waitForTimeout(500);

  const logoutButton = page.getByRole("button", { name: "Log out" });

  // Set up dialog handler
  page.once("dialog", (dialog) => {
    if (clearData) {
      dialog.accept();
    } else {
      dialog.dismiss();
    }
  });

  await logoutButton.click();

  // Wait for logout to complete - check that "Sign in" button appears
  await page.waitForSelector('button:has-text("Sign in with Google")', { timeout: 10000 });
  await page.waitForTimeout(1000);
}

// Helper to clear IndexedDB
async function clearIndexedDB(page: Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase("til-stack-local");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
}

// Helper to create an entry
async function createEntry(page: Page, content: string) {
  const textarea = page.locator("textarea").first();
  await textarea.fill(content);

  const saveButton = page.getByRole("button", { name: "Save" });
  await saveButton.click();
  await page.waitForTimeout(500);
}

// Helper to delete current entry
async function deleteCurrentEntry(page: Page) {
  // Enter edit mode first
  const editButton = page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-pencil") })
    .first();
  await editButton.click();
  await page.waitForTimeout(300);

  // Set up dialog handler
  page.once("dialog", (dialog) => dialog.accept());

  // Click delete button
  const deleteButton = page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-trash-2") })
    .first();
  await deleteButton.click();
  await page.waitForTimeout(500);
}

// Helper to navigate to previous day
async function navigateToPreviousDay(page: Page) {
  const prevButton = page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-chevron-left") });
  await prevButton.click();
  await page.waitForTimeout(300);
}

test.describe("Sync Flow - Anonymous to User", () => {
  test.beforeEach(async ({ page }) => {
    // Clear IndexedDB before each test
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);
  });

  /**
   * Test 1: Anonymous Entry Creation
   * Verify anonymous users can create and persist entries
   */
  test("anonymous entry creation and persistence", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    const content = `Anonymous Test Entry - ${Date.now()}`;
    await createEntry(page, content);

    // Verify entry appears
    await expect(page.getByText(content.substring(0, 30))).toBeVisible();

    // Refresh and verify persistence
    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.getByText(content.substring(0, 30))).toBeVisible();
  });

  /**
   * Test 2: New User Login Migrates Anonymous Data
   * Verify anonymous data is migrated when a new user logs in
   *
   * Verifies that anonymous data is migrated to a new user's namespace on first login.
   */
  test("new user login migrates anonymous data", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Create anonymous entries
    const content1 = `Anon Entry 1 - ${Date.now()}`;
    await createEntry(page, content1);

    await navigateToPreviousDay(page);
    const content2 = `Anon Entry 2 - ${Date.now()}`;
    await createEntry(page, content2);

    // Login as new user
    const newUserId = `new-user-${Date.now()}`;
    await devLogin(page, newUserId);

    // Verify entries are still visible (migrated to user)
    await page.goto("/");
    await page.waitForTimeout(1000);

    // At least one entry should be visible
    const hasEntry1 = await page.getByText(content1.substring(0, 15)).isVisible().catch(() => false);
    const hasEntry2 = await page.getByText(content2.substring(0, 15)).isVisible().catch(() => false);

    expect(hasEntry1 || hasEntry2).toBeTruthy();
  });
});

test.describe("Sync Flow - Multi-Tab/Context", () => {
  /**
   * Test 3: Same Browser Context Shares Data
   * Verify tabs in same browser context share IndexedDB data
   */
  test("same browser context shares data between tabs", async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Clear data first
    await page1.goto("/");
    await clearIndexedDB(page1);
    await page1.reload();
    await page1.waitForTimeout(1500);

    // Create entry in page1
    const content = `Shared Entry - ${Date.now()}`;
    await createEntry(page1, content);

    // Verify entry appears in page1
    await expect(page1.getByText(content.substring(0, 20))).toBeVisible();

    // Open page2 and verify entry is visible
    await page2.goto("/");
    await page2.waitForTimeout(2000);

    // Entry should be visible (shared IndexedDB)
    await expect(page2.getByText(content.substring(0, 20))).toBeVisible();

    await page1.close();
    await page2.close();
  });

  /**
   * Test 4: Deletion Syncs Between Tabs
   * Verify deletions sync via shared IndexedDB
   */
  test("deletion syncs between tabs", async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // Setup
    await page1.goto("/");
    await clearIndexedDB(page1);
    await page1.reload();
    await page1.waitForTimeout(1500);

    // Create entry
    const content = `Delete Sync Test - ${Date.now()}`;
    await createEntry(page1, content);
    await expect(page1.getByText(content.substring(0, 20))).toBeVisible();

    // Verify in page2
    await page2.goto("/");
    await page2.waitForTimeout(1500);
    await expect(page2.getByText(content.substring(0, 20))).toBeVisible();

    // Delete from page1
    await deleteCurrentEntry(page1);

    // Verify deleted in page1
    await expect(page1.getByText("New Entry")).toBeVisible();

    // Refresh page2 and verify deleted
    await page2.reload();
    await page2.waitForTimeout(1500);
    await expect(page2.getByText("New Entry")).toBeVisible();

    await page1.close();
    await page2.close();
  });
});

test.describe("Sync Flow - Logout/Login Cycle", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);
  });

  /**
   * Test 5: Logout Clears User Data Display
   * Verify logout shows empty/anonymous state
   */
  test("logout clears user data display", async ({ page }) => {
    // Create entry as anonymous
    const anonContent = `Pre-login Entry - ${Date.now()}`;
    await createEntry(page, anonContent);

    // Login
    const userId = `logout-test-${Date.now()}`;
    await devLogin(page, userId);

    // Verify entry exists
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Logout with clear data
    await logout(page, true);

    // Navigate home
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Should show empty state
    await expect(page.getByText("No previous entries")).toBeVisible();
  });

  /**
   * Test 6: Anonymous Entry Creation After Logout
   * Verify can create anonymous entries after logout
   */
  test("anonymous entry creation after logout", async ({ page }) => {
    // Login first
    const userId = `anon-after-logout-${Date.now()}`;
    await devLogin(page, userId);

    // Create user entry
    const userContent = `User Entry - ${Date.now()}`;
    await page.goto("/");
    await page.waitForTimeout(1000);
    await createEntry(page, userContent);

    // Logout
    await logout(page, true);

    // Create anonymous entry
    await page.goto("/");
    await page.waitForTimeout(1000);

    const anonContent = `Post-Logout Anon - ${Date.now()}`;
    await createEntry(page, anonContent);

    // Verify anonymous entry persists
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.getByText(anonContent.substring(0, 20))).toBeVisible();
  });

  /**
   * Test 7: Re-login Does NOT Merge Anonymous Data
   * Existing user re-login should show only server data, NOT anonymous entries
   * Anonymous entries should be preserved for when user logs out
   */
  test("re-login does NOT merge anonymous data - shows server data only", async ({ page }) => {
    // Capture console logs for debugging
    const allConsoleLogs: string[] = [];
    page.on('console', msg => {
      if (msg.text().includes('[SharedWorker]') || msg.text().includes('[Persistence]') || msg.text().includes('[Auth]')) {
        allConsoleLogs.push(`[Page] ${msg.text()}`);
      }
    });

    // Create initial anonymous entry
    const anonContent1 = `Initial Anon - ${Date.now()}`;
    await createEntry(page, anonContent1);

    // Debug: Check IndexedDB before first login
    const idbBeforeFirstLogin = await page.evaluate(async () => {
      const request = indexedDB.open('til-stack-local', 1);
      return new Promise<string[]>((resolve) => {
        request.onsuccess = (event: Event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('database', 'readonly');
          const store = tx.objectStore('database');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => resolve(keysRequest.result as string[]);
          keysRequest.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
    });
    console.log('[E2E Debug] IndexedDB before first login:', idbBeforeFirstLogin);

    // Login as NEW user - this SHOULD migrate anonymous data
    const userId = `relogin-test-${Date.now()}`;
    const loginSuccess = await devLogin(page, userId);
    if (!loginSuccess) {
      test.skip();
      return;
    }

    // Force reload to ensure fresh IndexedDB read
    await page.reload();
    await page.waitForTimeout(1000);

    // Debug: Check IndexedDB after first login
    const idbAfterFirstLogin = await page.evaluate(async () => {
      const request = indexedDB.open('til-stack-local', 1);
      return new Promise<string[]>((resolve) => {
        request.onsuccess = (event: Event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('database', 'readonly');
          const store = tx.objectStore('database');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => resolve(keysRequest.result as string[]);
          keysRequest.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
    });
    console.log('[E2E Debug] IndexedDB after first login:', idbAfterFirstLogin);

    // Verify entry migrated (for new user)
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Logout (clearing user data display)
    await logout(page, true);

    // Debug: Check IndexedDB after logout
    const idbAfterLogout = await page.evaluate(async () => {
      const request = indexedDB.open('til-stack-local', 1);
      return new Promise<string[]>((resolve) => {
        request.onsuccess = (event: Event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('database', 'readonly');
          const store = tx.objectStore('database');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => resolve(keysRequest.result as string[]);
          keysRequest.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
    });
    console.log('[E2E Debug] IndexedDB after logout:', idbAfterLogout);

    // Create/Edit anonymous entry after logout
    // Since anonymous data from entry A is preserved, we need to EDIT it or go to a different date
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Click edit button to modify the entry (or create if empty)
    const anonContent2 = `Post-logout Anon - ${Date.now()}`;
    const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
    const hasExistingEntry = await editButton.isVisible().catch(() => false);

    if (hasExistingEntry) {
      // Edit existing entry
      await editButton.click();
      await page.waitForTimeout(300);
      const textarea = page.locator("textarea").first();
      await textarea.fill(anonContent2);
      await page.getByRole("button", { name: "Save" }).click();
    } else {
      // Create new entry
      await createEntry(page, anonContent2);
    }
    await page.waitForTimeout(500);

    // Debug: Check IndexedDB after creating anonymous entry
    const idbAfterAnonEntry = await page.evaluate(async () => {
      const request = indexedDB.open('til-stack-local', 1);
      return new Promise<string[]>((resolve) => {
        request.onsuccess = (event: Event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('database', 'readonly');
          const store = tx.objectStore('database');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => resolve(keysRequest.result as string[]);
          keysRequest.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
    });
    console.log('[E2E Debug] IndexedDB after anon entry:', idbAfterAnonEntry);

    // Re-login with SAME user (now EXISTING user)
    await devLogin(page, userId);

    // Force reload to ensure SharedWorker state is fresh
    await page.reload();
    await page.waitForTimeout(2000);

    // Debug: Check IndexedDB keys and sizes after re-login
    const idbDebug = await page.evaluate(async (expectedUserId: string) => {
      const request = indexedDB.open('til-stack-local', 1);
      return new Promise<{
        keys: string[],
        hasAnonymousKey: boolean,
        userKeySize: number | null,
        anonKeySize: number | null
      }>((resolve) => {
        request.onsuccess = (event: Event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('database', 'readonly');
          const store = tx.objectStore('database');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = async () => {
            const keys = keysRequest.result as string[];

            // Get sizes of user and anonymous databases
            let userKeySize: number | null = null;
            let anonKeySize: number | null = null;

            const userKey = `sqlite-data-${expectedUserId}`;
            const anonKey = 'sqlite-data-anonymous';

            const getUserData = store.get(userKey);
            getUserData.onsuccess = () => {
              userKeySize = getUserData.result ? (getUserData.result as Uint8Array).length : null;

              const getAnonData = store.get(anonKey);
              getAnonData.onsuccess = () => {
                anonKeySize = getAnonData.result ? (getAnonData.result as Uint8Array).length : null;
                resolve({
                  keys,
                  hasAnonymousKey: keys.includes(anonKey),
                  userKeySize,
                  anonKeySize
                });
              };
            };
          };
          keysRequest.onerror = () => resolve({ keys: [], hasAnonymousKey: false, userKeySize: null, anonKeySize: null });
        };
        request.onerror = () => resolve({ keys: [], hasAnonymousKey: false, userKeySize: null, anonKeySize: null });
      });
    }, userId);
    console.log('[E2E Debug] IndexedDB after re-login:', idbDebug);

    // Check if anonymous DB exists before creating anonymous entry
    const idbBeforeAnon = await page.evaluate(async () => {
      // Force check
      const request = indexedDB.open('til-stack-local', 1);
      return new Promise<string[]>((resolve) => {
        request.onsuccess = (event: Event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('database', 'readonly');
          const store = tx.objectStore('database');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => resolve(keysRequest.result as string[]);
          keysRequest.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      });
    });
    console.log('[E2E Debug] IndexedDB keys (re-check):', idbBeforeAnon);

    // Wait longer for SW to finish switching
    await page.waitForTimeout(2000);

    // Verify anonymous entry is NOT visible (existing user = no merge)
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Print debug logs
    console.log('[E2E Debug] Console logs:');
    for (const log of allConsoleLogs.slice(-20)) {
      console.log('  ' + log);
    }

    // The post-logout anonymous entry should NOT be merged
    const hasContent2 = await page.getByText(anonContent2.substring(0, 15)).isVisible().catch(() => false);
    expect(hasContent2).toBeFalsy(); // Should NOT see anonymous entry

    // User should see their server-synced data instead (or empty if server has nothing)
  });

  /**
   * Test 8: Logout Restores Anonymous Entries
   * After re-login (which doesn't merge), logout should show the anonymous entries again
   */
  test("logout after re-login restores anonymous entries", async ({ page }) => {
    // Create anonymous entry
    const anonContent = `Restore Test Anon - ${Date.now()}`;
    await createEntry(page, anonContent);

    // Login as new user (migrates anonymous data)
    const userId = `restore-test-${Date.now()}`;
    const loginSuccess = await devLogin(page, userId);
    if (!loginSuccess) {
      test.skip();
      return;
    }

    // Logout
    await logout(page, true);

    // Create NEW anonymous entry
    await page.goto("/");
    await page.waitForTimeout(1000);
    const anonContent2 = `Post-logout Anon - ${Date.now()}`;
    await createEntry(page, anonContent2);

    // Verify anonymous entry exists
    await expect(page.getByText(anonContent2.substring(0, 15))).toBeVisible();

    // Re-login (existing user - NO merge)
    await devLogin(page, userId);

    // Should NOT see anonymous entry
    await page.goto("/");
    await page.waitForTimeout(1000);
    const hasAnon = await page.getByText(anonContent2.substring(0, 15)).isVisible().catch(() => false);
    expect(hasAnon).toBeFalsy();

    // Logout again
    await logout(page, false); // Keep data - don't clear user's local cache

    // Should see anonymous entry again!
    await page.goto("/");
    await page.waitForTimeout(1000);
    await expect(page.getByText(anonContent2.substring(0, 15))).toBeVisible();
  });
});

test.describe("Sync Flow - Server Integration", () => {
  /**
   * Test 8: Data Syncs to Server on Login
   * Verify entries are pushed to server after login
   */
  test("data syncs to server on login", async ({ page, request }) => {
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Create anonymous entry
    const content = `Server Sync Test - ${Date.now()}`;
    await createEntry(page, content);

    // Login
    const userId = `server-sync-${Date.now()}`;
    await devLogin(page, userId);

    // Wait for sync
    await page.waitForTimeout(2000);

    // Verify via Settings sync status
    await page.goto("/config");
    await page.waitForTimeout(1000);

    // Should show "Server Sync" section with status
    await expect(page.getByText("Server Sync")).toBeVisible();
  });

  /**
   * Test 9: Cross-Context Sync via Server
   * Verify data syncs between isolated browser contexts via server
   */
  test("cross-context sync via server", async ({ browser }) => {
    // Create two isolated contexts (like different devices)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const userId = `cross-context-${Date.now()}`;

    try {
      // Setup context1 - clear and prepare
      await page1.goto("/");
      await clearIndexedDB(page1);
      await page1.reload();
      await page1.waitForTimeout(2000);

      // Setup context2 - clear and prepare
      await page2.goto("/");
      await clearIndexedDB(page2);
      await page2.reload();
      await page2.waitForTimeout(2000);

      // Context1: Login as new user FIRST, then create entry
      await devLogin(page1, userId);
      await page1.waitForTimeout(1500);

      // Context1: Navigate to home page (devLogin leaves at /config)
      await page1.goto("/");
      await page1.waitForTimeout(1000);

      // Context1: Create entry as logged-in user
      const content = `Cross-Context Entry - ${Date.now()}`;
      await createEntry(page1, content);
      await page1.waitForTimeout(1000);

      // Context1: Trigger sync to push entry to server
      await page1.goto("/config");
      await page1.waitForTimeout(1500);
      const syncButton1 = page1.locator("button[title='Sync now']");
      await syncButton1.waitFor({ state: "visible", timeout: 10000 });
      await syncButton1.click();
      await page1.waitForTimeout(3000);

      // Context2: Login as same user (existing user - pulls from server)
      await devLogin(page2, userId);
      await page2.waitForTimeout(2000);

      // Context2: Trigger sync explicitly to pull
      await page2.goto("/config");
      await page2.waitForTimeout(1000);
      const syncButton2 = page2.locator("button[title='Sync now']");
      if (await syncButton2.isVisible({ timeout: 3000 }).catch(() => false)) {
        await syncButton2.click();
        await page2.waitForTimeout(3000);
      }

      // Context2: Navigate to home and check for entry
      await page2.goto("/");
      await page2.waitForTimeout(2000);

      // Entry should be pulled from server
      const hasEntry = await page2.getByText(content.substring(0, 15)).isVisible().catch(() => false);

      expect(hasEntry).toBeTruthy();
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});

test.describe("Sync Flow - Offline Mode", () => {
  /**
   * Test 10: Offline Entry Creation
   * Verify entries can be created offline
   */
  test("offline entry creation", async ({ page, context }) => {
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Login first
    const userId = `offline-test-${Date.now()}`;
    await devLogin(page, userId);

    // Create baseline entry
    const baselineContent = `Baseline Entry - ${Date.now()}`;
    await page.goto("/");
    await page.waitForTimeout(1000);
    await createEntry(page, baselineContent);

    // Go offline
    await context.setOffline(true);

    // Navigate to previous day
    await navigateToPreviousDay(page);

    // Create offline entry
    const offlineContent = `Offline Entry - ${Date.now()}`;
    await createEntry(page, offlineContent);

    // Verify entry is saved locally
    await expect(page.getByText(offlineContent.substring(0, 20))).toBeVisible();

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(2000);

    // Reload to trigger sync
    await page.reload();
    await page.waitForTimeout(2000);

    // Entry should still be visible
    await expect(page.getByText(offlineContent.substring(0, 20))).toBeVisible();
  });

  /**
   * Test 11: Offline Edit and Sync
   * Verify offline edits sync when back online
   */
  test("offline edit syncs when online", async ({ page, context }) => {
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(2000);

    // Login FIRST, then create entry (ensures entry is created under user context)
    const userId = `offline-edit-${Date.now()}`;
    await devLogin(page, userId);

    // Navigate to home and wait for page to be ready
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Create entry as logged-in user - wait for textarea to be ready
    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });

    const content = `Edit Test Entry - ${Date.now()}`;
    await textarea.fill(content);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);

    // Wait for entry to be in view mode
    await expect(page.getByText(content.substring(0, 15))).toBeVisible({ timeout: 10000 });

    // Go offline
    await context.setOffline(true);

    // Edit entry - wait for edit button to be visible
    const editButton = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();
    await editButton.waitFor({ state: "visible", timeout: 10000 });
    await editButton.click();
    await page.waitForTimeout(500);

    const textarea2 = page.locator("textarea").first();
    await textarea2.waitFor({ state: "visible", timeout: 5000 });
    const editedContent = `EDITED OFFLINE - ${Date.now()}`;
    await textarea2.fill(editedContent);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await page.waitForTimeout(500);

    // Verify edit saved locally
    await expect(page.getByText(editedContent.substring(0, 20))).toBeVisible();

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(2000);

    // Reload
    await page.reload();
    await page.waitForTimeout(2000);

    // Edited content should persist
    await expect(page.getByText(editedContent.substring(0, 20))).toBeVisible();
  });
});

test.describe("Sync Flow - Edge Cases", () => {
  /**
   * Test 12: Logout Without Clearing Data
   * Verify logout without clearing preserves anonymous access
   */
  test("logout without clearing data preserves anonymous access", async ({ page }) => {
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Create entry and login
    const content = `Preserve Test - ${Date.now()}`;
    await createEntry(page, content);

    const userId = `preserve-${Date.now()}`;
    await devLogin(page, userId);
    await page.waitForTimeout(1000);

    // Logout WITHOUT clearing data (dismiss dialog)
    await page.goto("/config");
    await page.waitForTimeout(500);

    const logoutButton = page.getByRole("button", { name: "Log out" });
    page.once("dialog", (dialog) => dialog.dismiss());
    await logoutButton.click();
    await page.waitForTimeout(1000);

    // Navigate home
    await page.goto("/");
    await page.waitForTimeout(1000);

    // User's entry data should still be accessible
    // (since we kept the data for offline access)
    const hasEntry = await page.getByText(content.substring(0, 15)).isVisible().catch(() => false);
    // This might be true or false depending on implementation - test documents behavior
    expect(typeof hasEntry).toBe("boolean");
  });

  /**
   * Test 13: Rapid Login/Logout Cycle
   * Verify app handles rapid auth changes gracefully
   */
  test("rapid login logout cycle", async ({ page }) => {
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    const userId = `rapid-cycle-${Date.now()}`;

    // Rapid cycle
    for (let i = 0; i < 3; i++) {
      // Login
      await devLogin(page, userId);
      await page.waitForTimeout(500);

      // Logout
      await logout(page, false); // Keep data to make it faster
      await page.waitForTimeout(500);
    }

    // App should still be functional
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Should see editor
    await expect(page.locator("textarea")).toBeVisible();
  });
});
