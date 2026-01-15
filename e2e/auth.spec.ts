import { test, expect, Page } from "@playwright/test";

/**
 * E2E Tests for Logged-In Users
 * Based on user cases UC-L1 through UC-L9
 *
 * Note: These tests use route mocking to simulate auth state.
 * tRPC uses httpBatchLink, so all responses must be arrays.
 */

// Helper to intercept auth.me endpoint to return mock user
async function mockAuthEndpoint(page: Page) {
  await page.route("**/trpc/auth.me**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          result: {
            data: {
              id: "test-user-123",
              googleId: "google-test-123456789",
            },
          },
        },
      ]),
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
      body: JSON.stringify([{ result: { data: null } }]),
    });
  });
}

// Helper to mock entries.list endpoint
async function mockEntriesList(page: Page, items: unknown[] = []) {
  await page.route("**/trpc/entries.list**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          result: {
            data: { items, nextCursor: null },
          },
        },
      ]),
    });
  });
}

// Helper to mock webhooks.list endpoint
async function mockWebhooksList(page: Page, webhooks: unknown[] = []) {
  await page.route("**/trpc/webhooks.list**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ result: { data: webhooks } }]),
    });
  });
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

    // Should see sync status
    await expect(page.getByText("Server Sync")).toBeVisible();
    await expect(page.getByText(/Last synced:/)).toBeVisible();

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

    // Should show syncing state
    await expect(page.getByText("Syncing...")).toBeVisible();

    // Wait and verify sync completed
    await page.waitForTimeout(2000);
    await expect(page.getByText(/Last synced:/)).toBeVisible();
  });

  /**
   * UC-L4: Auto Sync on Mutation
   * Sync triggers automatically after data changes.
   */
  test("auth-auto-sync: triggers sync after mutation", async ({ page }) => {
    await mockAuthEndpoint(page);
    await mockEntriesList(page);

    await page.goto("/");
    await page.waitForTimeout(1000);

    // Create an entry
    const textarea = page.locator("textarea").first();
    await textarea.fill(`Auto sync test ${Date.now()}`);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();

    // Wait for debounced sync
    await page.waitForTimeout(3000);

    // Verify sync status in settings
    await page.goto("/config");
    await page.waitForTimeout(500);
    await expect(page.getByText(/Last synced:/)).toBeVisible();
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

    // Mock logout endpoints
    await page.route("**/trpc/auth.logout**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: { success: true } } }]),
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

    // Mock endpoints
    await page.route("**/trpc/auth.deleteAccount**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ result: { data: { success: true } } }]),
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
   */
  test("auth-data-persistence: local data persists across auth changes", async ({ page }) => {
    // Start as guest
    await page.goto("/");
    await page.waitForTimeout(1000);

    const textarea = page.locator("textarea").first();
    const content = `Persistent entry ${Date.now()}`;
    await textarea.fill(content);

    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(500);

    // "Login"
    await mockAuthEndpoint(page);
    await page.reload();
    await page.waitForTimeout(1000);

    // Entry should persist
    await expect(page.getByText(content.substring(0, 20))).toBeVisible();

    // "Logout"
    await mockAuthLoggedOut(page);
    await page.reload();
    await page.waitForTimeout(1000);

    // Entry should still persist
    await expect(page.getByText(content.substring(0, 20))).toBeVisible();
  });

  /**
   * UC-L9: Sync Conflict Resolution
   * Conflicts are resolved using last-write-wins.
   */
  test("auth-sync-conflict: resolves conflicts with last-write-wins", async ({ page }) => {
    await mockAuthEndpoint(page);

    const today = new Date().toISOString().split("T")[0];
    const localContent = "Local content (newer)";

    // Mock server with older entry
    await page.route("**/trpc/entries.list**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            result: {
              data: {
                items: [
                  {
                    id: "entry-1",
                    date: today,
                    content: "Server content (older)",
                    updatedAt: new Date(Date.now() - 60000).toISOString(),
                    createdAt: new Date(Date.now() - 60000).toISOString(),
                  },
                ],
                nextCursor: null,
              },
            },
          },
        ]),
      });
    });

    await page.goto("/");
    await page.waitForTimeout(1000);

    // Create local entry (newer)
    const textarea = page.locator("textarea").first();
    await textarea.fill(localContent);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(500);

    // Local content should be visible (it's newer)
    await expect(page.getByText(localContent.substring(0, 15))).toBeVisible();
  });
});

test.describe("Logged-In User - Integration", () => {
  /**
   * Full flow test
   */
  test("integration: full user flow", async ({ page }) => {
    // Start as guest
    await page.goto("/");
    await page.waitForTimeout(1000);

    const content = `Guest entry ${Date.now()}`;
    await page.locator("textarea").first().fill(content);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(500);

    // Verify saved
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(page.getByText(content.substring(0, 20))).toBeVisible();

    // "Login"
    await mockAuthEndpoint(page);
    await mockEntriesList(page);
    await page.reload();
    await page.waitForTimeout(1000);

    // Entry persists
    await expect(page.getByText(content.substring(0, 20))).toBeVisible();

    // Check settings shows logged in state
    await page.goto("/config");
    await page.waitForTimeout(500);
    await expect(page.getByText("Server Sync")).toBeVisible();

    // "Logout"
    await mockAuthLoggedOut(page);
    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.getByRole("button", { name: /Sign in with Google/i })).toBeVisible();

    // Entry still persists
    await page.goto("/");
    await page.waitForTimeout(500);
    await expect(page.getByText(content.substring(0, 20))).toBeVisible();
  });
});
