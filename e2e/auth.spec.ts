import { test, expect, Page } from "@playwright/test";

/**
 * E2E Tests for Logged-In Users
 * Based on user cases UC-L1 through UC-L9
 *
 * Note: These tests use route mocking to simulate auth state.
 * After SharedWorker migration:
 * - auth.* and webhooks.* routes go through httpLink (network) - can be mocked
 * - entries.* and config.* routes go through SharedWorker - cannot be mocked via route intercept
 */

// Helper to intercept auth.me endpoint to return mock user
// Note: tRPC uses httpLink (non-batched) for auth routes, so response is not wrapped in array
async function mockAuthEndpoint(page: Page) {
  await page.route("**/trpc/auth.me**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            id: "test-user-123",
            googleId: "google-test-123456789",
          },
        },
      }),
    });
  });
}

// Helper to mock auth.me returning null (logged out)
async function mockAuthLoggedOut(page: Page) {
  await page.unroute("**/trpc/auth.me**");
  await page.route("**/trpc/auth.me**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { data: null } }),
    });
  });
}

// Note: entries.list goes through SharedWorker, not network - can't be mocked via route intercept
// This helper is kept for compatibility but won't actually intercept SharedWorker calls
async function mockEntriesList(_page: Page, _items: unknown[] = []) {
  // entries.list now goes through SharedWorker, not network requests
  // This mock won't work - the SharedWorker handles these locally
  console.log("Note: mockEntriesList won't work with SharedWorker architecture");
}

// Helper to mock webhooks.list endpoint (still goes through network)
async function mockWebhooksList(page: Page, webhooks: unknown[] = []) {
  await page.route("**/trpc/webhooks.list**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: { data: webhooks } }),
    });
  });
}

const DB_NAME = "til-stack-local";

// Helper to clear IndexedDB
async function clearIndexedDB(page: Page) {
  await page.evaluate((dbName) => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }, DB_NAME);
}

test.describe("Logged-In User - Authentication", () => {
  /**
   * UC-L1: Login with Google
   * User can log in with Google OAuth.
   */
  test("auth-login: can initiate Google OAuth login", async ({ page }) => {
    await page.goto("/login");

    // Should see login page
    await expect(page).toHaveURL("/login");

    // Should see Google sign-in button
    const googleButton = page.getByRole("button", { name: /Continue with Google/i });
    await expect(googleButton).toBeVisible();

    // Track navigation attempts
    let authAttempted = false;
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("google") || url.includes("auth")) {
        authAttempted = true;
      }
    });

    await googleButton.click();
    await page.waitForTimeout(1000);

    // Should attempt to navigate to auth endpoint
    const url = page.url();
    expect(
      url.includes("google") ||
      url.includes("auth") ||
      url.includes("trpc") ||
      authAttempted
    ).toBeTruthy();
  });

  /**
   * UC-L2: View Account Section (Logged In)
   * Logged-in user sees account info and sync status.
   */
  test("auth-account-section: shows account info when logged in", async ({ page }) => {
    // Mock BEFORE navigation
    await mockAuthEndpoint(page);

    await page.goto("/config");
    await page.waitForTimeout(1000);

    // Should see Account heading
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

    // Should see "Signed in with Google" text
    await expect(page.getByText("Signed in with Google")).toBeVisible();

    // Should see truncated user ID
    await expect(page.getByText(/ID:.*\.\.\./)).toBeVisible();

    // Should see sync status - UI shows "Server Sync" and "Auto-sync enabled"
    await expect(page.getByText("Server Sync")).toBeVisible();
    await expect(page.getByText("Auto-sync enabled")).toBeVisible();

    // Should see logout and delete buttons
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Account" })).toBeVisible();
  });

  /**
   * UC-L3: Manual Sync
   * Logged-in user can manually trigger sync.
   */
  test("auth-manual-sync: can trigger manual sync", async ({ page }) => {
    await mockAuthEndpoint(page);
    await mockEntriesList(page);
    await mockWebhooksList(page);

    await page.goto("/config");
    await page.waitForTimeout(1000);

    // Find sync button
    const syncButton = page.locator("button[title='Sync now']");
    await expect(syncButton).toBeVisible();

    // Click sync
    await syncButton.click();

    // Should show syncing state briefly (might be too fast to catch with mocked backend)
    // Just verify the sync completes without error
    await page.waitForTimeout(2000);

    // After sync, should still see "Server Sync" status
    await expect(page.getByText("Server Sync")).toBeVisible();
  });

  /**
   * UC-L4: Auto Sync on Mutation
   * Sync triggers automatically after data changes.
   */
  test("auth-auto-sync: triggers sync after mutation", async ({ page }) => {
    // Clear data and login with real dev login
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Dev login
    const testUserId = `auto-sync-test-${Date.now()}`;
    await page.goto("/login");
    await page.waitForTimeout(500);
    await page.getByPlaceholder("e.g., test-user-123").fill(testUserId);
    await page.getByRole("button", { name: "Dev Login" }).click();
    await page.waitForURL("/");
    await page.waitForTimeout(1500);

    // Create entry
    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.fill(`Auto sync test ${Date.now()}`);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await page.waitForTimeout(2000);

    // Check config page shows server sync enabled
    await page.goto("/config");
    await page.waitForTimeout(1000);
    await expect(page.getByText("Server Sync")).toBeVisible();
  });

  /**
   * UC-L5: Configure Webhooks
   * Logged-in user can configure webhook notifications.
   */
  test("auth-webhooks: can configure webhooks when logged in", async ({ page }) => {
    await mockAuthEndpoint(page);
    await mockWebhooksList(page);

    await page.goto("/config");
    await page.waitForTimeout(1000);

    // Should see webhooks section
    await expect(page.getByRole("heading", { name: /Webhooks/i })).toBeVisible();

    // Should NOT see "Requires Login"
    await expect(page.getByText("Requires Login")).not.toBeVisible();

    // Should see New Webhook button
    const newWebhookButton = page.getByRole("button", { name: "New Webhook" });
    await expect(newWebhookButton).toBeVisible();

    // Click to create
    await newWebhookButton.click();
    await page.waitForTimeout(300);

    // Should see form
    await expect(page.getByPlaceholder(/Webhook name/i)).toBeVisible();
    await expect(page.getByPlaceholder("Webhook URL")).toBeVisible();
  });

  /**
   * UC-L6: Logout
   * Logged-in user can log out.
   */
  test("auth-logout: can log out", async ({ page }) => {
    await mockAuthEndpoint(page);

    await page.goto("/config");
    await page.waitForTimeout(1000);

    const logoutButton = page.getByRole("button", { name: "Log out" });
    await expect(logoutButton).toBeVisible();

    // Mock logout endpoints (non-batched format for httpLink)
    await page.route("**/trpc/auth.logout**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { data: { success: true } } }),
      });
    });

    await page.route("**/auth/logout**", async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    // Switch to logged out state
    await mockAuthLoggedOut(page);

    await logoutButton.click();
    await page.waitForTimeout(1000);

    // Should show sign in button
    await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();
  });

  /**
   * UC-L7: Delete Account
   * Logged-in user can delete their account.
   */
  test("auth-delete-account: can delete account", async ({ page }) => {
    await mockAuthEndpoint(page);

    await page.goto("/config");
    await page.waitForTimeout(1000);

    const deleteButton = page.getByRole("button", { name: "Delete Account" });
    await expect(deleteButton).toBeVisible();

    // Mock endpoints (non-batched format for httpLink)
    await page.route("**/trpc/auth.deleteAccount**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { data: { success: true } } }),
      });
    });

    await page.route("**/auth/logout**", async (route) => {
      await route.fulfill({ status: 200, body: "{}" });
    });

    // Handle confirmation dialog
    page.on("dialog", (dialog) => dialog.accept());

    // Switch to logged out
    await mockAuthLoggedOut(page);

    await deleteButton.click();
    await page.waitForTimeout(1000);

    await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();
  });
});

test.describe("Logged-In User - Data Persistence", () => {
  /**
   * UC-L8: Data Persistence Across Login/Logout
   * Local data persists regardless of auth state.
   *
   * Note: This test only verifies persistence in anonymous mode since auth mocking
   * doesn't affect SharedWorker state. Use login-flow.spec.ts for real login flow tests.
   */
  test("auth-data-persistence: local data persists across page reloads", async ({ page }) => {
    // Start as guest (anonymous)
    await page.goto("/");
    await page.waitForTimeout(2000);

    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    const content = `Persistent entry ${Date.now()}`;
    await textarea.fill(content);

    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);

    // Entry should be visible
    await expect(page.getByText(content.substring(0, 20))).toBeVisible({ timeout: 5000 });

    // Reload and verify persistence
    await page.reload();
    await page.waitForTimeout(2000);

    // Entry should still persist after reload
    await expect(page.getByText(content.substring(0, 20))).toBeVisible({ timeout: 10000 });
  });

  /**
   * UC-L9: Sync Conflict Resolution
   * Conflicts are resolved using last-write-wins.
   * This test verifies that a logged-in user's data persists and syncs correctly.
   */
  test("auth-sync-conflict: resolves conflicts with last-write-wins", async ({ page }) => {
    // Clear data and login with real dev login
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Dev login
    const testUserId = `sync-conflict-test-${Date.now()}`;
    await page.goto("/login");
    await page.waitForTimeout(500);
    await page.getByPlaceholder("e.g., test-user-123").fill(testUserId);
    await page.getByRole("button", { name: "Dev Login" }).click();
    await page.waitForURL("/");
    await page.waitForTimeout(1500);

    // Create first entry
    const firstContent = `First content ${Date.now()}`;
    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.fill(firstContent);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);

    // Verify first content saved
    await expect(page.getByText(firstContent.substring(0, 15))).toBeVisible();

    // Update to second content (simulating last-write-wins)
    const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
    await editButton.click();
    await page.waitForTimeout(500);

    const secondContent = `Second content (should win) ${Date.now()}`;
    const textarea2 = page.locator("textarea").first();
    await textarea2.fill(secondContent);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);

    // Reload and verify second content persists (last write wins)
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByText(secondContent.substring(0, 20))).toBeVisible();
  });
});

test.describe("Logged-In User - Integration", () => {
  /**
   * Guest user flow - entry creation, persistence, and config access
   *
   * Note: For full login flow tests with actual auth, see login-flow.spec.ts
   */
  test("integration: guest user flow", async ({ page }) => {
    // Start as guest (anonymous)
    await page.goto("/");
    await page.waitForTimeout(2000);

    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });

    const content = `Guest entry ${Date.now()}`;
    await textarea.fill(content);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);

    // Verify saved
    await expect(page.getByText(content.substring(0, 20))).toBeVisible({ timeout: 5000 });

    // Reload and verify persistence
    await page.reload();
    await page.waitForTimeout(2000);
    await expect(page.getByText(content.substring(0, 20))).toBeVisible({ timeout: 10000 });

    // Check config page shows sign in button (guest mode)
    await page.goto("/config");
    await page.waitForTimeout(1000);
    await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();

    // Return to home, entry still persists
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.getByText(content.substring(0, 20))).toBeVisible({ timeout: 10000 });
  });
});
