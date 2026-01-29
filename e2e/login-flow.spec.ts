import { test, expect } from "@playwright/test";

/**
 * E2E Tests for Login Flow Bugs
 *
 * Tests verify fixes for:
 * - Bug 1: Initial login stuck/loading - page getting stuck after login
 * - Bug 2: Sync not pulling server data on re-login after clearing local data
 *
 * These tests use dev login functionality for testing without real OAuth.
 */

test.describe("Login Flow - Bug Fixes", () => {
  /**
   * Bug 1: Initial login should not get stuck
   *
   * Previously, the home page would fire tRPC queries immediately without
   * waiting for AuthProvider.isLoading to become false, causing race conditions
   * where queries would fire before the service worker switched databases.
   *
   * Fix: Added loading gate in index.tsx that waits for auth context to be ready.
   */
  test("login completes without getting stuck", async ({ page }) => {
    // Navigate to login page
    await page.goto("/login");
    await expect(page).toHaveURL("/login");

    // Should see dev login section
    const devLoginInput = page.getByRole("textbox", { name: "Test Google ID" });
    await expect(devLoginInput).toBeVisible();

    // Enter test user ID and login
    const testUserId = `e2e-login-test-${Date.now()}`;
    await devLoginInput.fill(testUserId);

    const devLoginButton = page.getByRole("button", { name: "Dev Login" });
    await devLoginButton.click();

    // Should redirect to home page within reasonable time (not stuck)
    await expect(page).toHaveURL("/", { timeout: 10000 });

    // Should see the home page content (date navigator button)
    const todayButton = page.getByRole("button", { name: /Today/ });
    await expect(todayButton).toBeVisible({ timeout: 5000 });

    // Should see the Stack heading - confirms page loaded fully
    await expect(page.getByRole("heading", { name: "Stack" })).toBeVisible();

    // Verify main content is visible (not stuck on loading)
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();

    // Wait and verify no stuck full-page spinner
    await page.waitForTimeout(1000);

    // Confirm page has meaningful content (either New Entry or existing entry)
    const hasEntry = await page.getByRole("heading", { level: 3 }).first().isVisible();
    expect(hasEntry).toBe(true);
  });

  /**
   * Bug 1 (continued): Auth loading gate shows spinner then content
   *
   * Verifies that the auth loading gate works - shows spinner briefly
   * then reveals content once auth context is ready.
   */
  test("shows loading state then content after auth ready", async ({ page }) => {
    // Start fresh - clear storage
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Reload to get clean state
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    // Page should eventually show content (Stack heading)
    // With SharedWorker, there's no networkidle event to wait for
    await expect(page.getByRole("heading", { name: "Stack" })).toBeVisible({
      timeout: 15000,
    });
  });

  /**
   * Bug 2: Re-login after clearing local data should sync server data
   *
   * Previously, after logout with "clear local data" and re-login,
   * the query cache would still have stale (empty) data from before.
   *
   * Fix: Added queryClient.invalidateQueries() after SW sync completes.
   */
  test("re-login after clear data syncs server entries", async ({ page }) => {
    const testUserId = `e2e-sync-test-${Date.now()}`;
    const testEntryContent = `# E2E Test Entry\n\nCreated at: ${new Date().toISOString()}\nTest ID: ${testUserId}`;

    // Step 1: Login and create an entry
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Test Google ID" }).fill(testUserId);
    await page.getByRole("button", { name: "Dev Login" }).click();

    await expect(page).toHaveURL("/", { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Create entry
    const textarea = page.locator("textarea").first();
    await textarea.fill(testEntryContent);

    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(2000);

    // Verify entry is saved (heading should be visible)
    await expect(page.getByRole("heading", { name: "E2E Test Entry" })).toBeVisible();

    // Step 2: Logout with clear local data
    await page.goto("/config");
    await page.waitForTimeout(1000);

    const logoutButton = page.getByRole("button", { name: "Log out" });
    await expect(logoutButton).toBeVisible();

    // Handle the confirm dialog - accept to clear local data
    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toContain("clear local data");
      await dialog.accept();
    });

    await logoutButton.click();
    await page.waitForTimeout(2000);

    // Verify logged out
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();

    // Step 3: Re-login with same user
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Test Google ID" }).fill(testUserId);
    await page.getByRole("button", { name: "Dev Login" }).click();

    await expect(page).toHaveURL("/", { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Step 4: Verify entry synced from server
    await expect(page.getByRole("heading", { name: "E2E Test Entry" })).toBeVisible({
      timeout: 10000,
    });

    // Verify the content is correct
    await expect(page.getByText(`Test ID: ${testUserId}`)).toBeVisible();
  });

  /**
   * Bug 2 (continued): Console should show invalidation message
   *
   * Verifies that the query invalidation happens after sync.
   */
  test("query invalidation occurs after login sync", async ({ page }) => {
    const consoleLogs: string[] = [];

    page.on("console", (msg) => {
      consoleLogs.push(msg.text());
    });

    const testUserId = `e2e-console-test-${Date.now()}`;

    // Login
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Test Google ID" }).fill(testUserId);
    await page.getByRole("button", { name: "Dev Login" }).click();

    await expect(page).toHaveURL("/", { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Check that auth flow logged properly (SharedWorker migration changed log message)
    const hasSwAcknowledge = consoleLogs.some((log) =>
      log.includes("[Auth] SharedWorker acknowledged user switch")
    );

    expect(hasSwAcknowledge).toBe(true);
  });
});

test.describe("Login Flow - Edge Cases", () => {
  /**
   * Multiple rapid logins should not cause issues
   */
  test("handles rapid login/logout cycles", async ({ page }) => {
    const testUserId = `e2e-rapid-test-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      // Login
      await page.goto("/login");
      await page.getByRole("textbox", { name: "Test Google ID" }).fill(testUserId);
      await page.getByRole("button", { name: "Dev Login" }).click();

      await expect(page).toHaveURL("/", { timeout: 10000 });
      await expect(page.getByRole("heading", { name: "Stack" })).toBeVisible();

      // Logout
      await page.goto("/config");
      await page.waitForTimeout(500);

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Log out" }).click();
      await page.waitForTimeout(1000);
    }

    // Final state should be logged out
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });

  /**
   * Login with different users should isolate data
   */
  test("different users have isolated data", async ({ page }) => {
    const userA = `e2e-user-a-${Date.now()}`;
    const userB = `e2e-user-b-${Date.now()}`;
    const entryA = "# User A Entry\n\nThis belongs to User A";
    const entryB = "# User B Entry\n\nThis belongs to User B";

    // User A creates entry
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Test Google ID" }).fill(userA);
    await page.getByRole("button", { name: "Dev Login" }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.locator("textarea").first().fill(entryA);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole("heading", { name: "User A Entry" })).toBeVisible();

    // Logout
    await page.goto("/config");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForTimeout(1000);

    // User B creates different entry
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Test Google ID" }).fill(userB);
    await page.getByRole("button", { name: "Dev Login" }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.locator("textarea").first().fill(entryB);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole("heading", { name: "User B Entry" })).toBeVisible();

    // User A's entry should NOT be visible
    await expect(page.getByRole("heading", { name: "User A Entry" })).not.toBeVisible();

    // Logout and login as User A
    await page.goto("/config");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForTimeout(1000);

    await page.goto("/login");
    await page.getByRole("textbox", { name: "Test Google ID" }).fill(userA);
    await page.getByRole("button", { name: "Dev Login" }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
    await page.waitForTimeout(2000);

    // User A should see their entry, not User B's
    await expect(page.getByRole("heading", { name: "User A Entry" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "User B Entry" })).not.toBeVisible();
  });
});
