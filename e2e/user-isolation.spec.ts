import { test, expect, Page } from "@playwright/test";

/**
 * E2E Tests for User Isolation in Local IndexedDB
 *
 * These tests verify that:
 * 1. New users get guest data migrated (moved, not copied)
 * 2. Old users do NOT get guest data - they see only their own data
 * 3. Guest data is preserved when old users log in/out
 * 4. Different users have completely isolated data namespaces
 */

const DB_NAME = "til-stack-local";

// Helper to clear all IndexedDB data for clean test state
async function clearAllIndexedDB(page: Page) {
  await page.evaluate((dbName) => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }, DB_NAME);
}

// Helper to perform dev login
async function devLogin(page: Page, googleId: string): Promise<{ userId: string; isNewUser: boolean }> {
  await page.goto("/login");
  await page.waitForTimeout(500);

  const textbox = page.getByRole("textbox", { name: "Test Google ID" });
  await textbox.fill(googleId);

  // Capture console logs to get login result
  const loginPromise = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[DevLogin]"),
    timeout: 10000,
  });

  await page.getByRole("button", { name: "Dev Login" }).click();

  const logMsg = await loginPromise;
  const match = logMsg.text().match(/userId=([^,]+), isNewUser=(\w+)/);

  await page.waitForURL("/");
  await page.waitForTimeout(1000);

  return {
    userId: match?.[1] || "",
    isNewUser: match?.[2] === "true",
  };
}

// Helper to logout (with option to clear local data)
async function logout(page: Page, clearData: boolean = false) {
  await page.goto("/config");
  await page.waitForTimeout(500);

  // Handle the confirmation dialog - use once() to avoid accumulating handlers
  page.once("dialog", async (dialog) => {
    if (clearData) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForTimeout(1500);
}

// Helper to create an entry as current user
async function createEntry(page: Page, content: string) {
  await page.goto("/");
  await page.waitForTimeout(1500);

  // Check if we're in view mode (entry exists) - need to click edit button first
  const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
  if (await editButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editButton.click();
    await page.waitForTimeout(500);
  }

  // Wait for textarea to be visible and ready
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await textarea.fill(content);

  // Wait for save button to be enabled and click
  const saveButton = page.getByRole("button", { name: "Save" });
  await saveButton.waitFor({ state: "visible", timeout: 5000 });
  await saveButton.click();
  await page.waitForTimeout(1000);
}

// Helper to get current entry content (if any)
async function getCurrentEntryContent(page: Page): Promise<string | null> {
  await page.goto("/");
  await page.waitForTimeout(2000);

  // Check if there's a "New Entry" indicator (no content)
  const newEntry = page.getByText("New Entry");
  if (await newEntry.isVisible({ timeout: 2000 }).catch(() => false)) {
    return null;
  }

  // Try to get the rendered paragraph content (the entry body)
  // Look for paragraph that contains the unique test content markers
  const paragraph = page.locator("main p").first();
  if (await paragraph.isVisible({ timeout: 2000 }).catch(() => false)) {
    return await paragraph.textContent();
  }

  // Also check for heading content (some entries render as h1)
  const heading = page.locator("main h1").first();
  if (await heading.isVisible({ timeout: 1000 }).catch(() => false)) {
    return await heading.textContent();
  }

  return null;
}

test.describe("User Isolation - New User Scenario", () => {
  // These tests involve service worker operations which can be slow
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    // Clear all IndexedDB data for clean state
    await page.goto("/");
    await clearAllIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(2000);
  });

  /**
   * Scenario 1: New User Migration
   *
   * 1. Guest creates entry
   * 2. New user (Alpha) logs in → data migrates
   * 3. Alpha sees migrated data
   * 4. Alpha logs out (with clear data)
   * 5. New user (Beta) logs in → sees EMPTY (not Alpha's data)
   */
  test("new-user-migration: guest data migrates to new user, not shared with other users", async ({
    page,
  }) => {
    const guestContent = `GUEST-UNIQUE-${Date.now()}: Guest entry for migration test`;
    const alphaId = `test-alpha-${Date.now()}`;
    const betaId = `test-beta-${Date.now()}`;

    // Step 1: Create guest entry
    await createEntry(page, guestContent);

    // Verify guest entry was created
    const guestEntryContent = await getCurrentEntryContent(page);
    expect(guestEntryContent).toContain("GUEST-UNIQUE");

    // Step 2: Login as Alpha (new user)
    const alphaLogin = await devLogin(page, alphaId);
    expect(alphaLogin.isNewUser).toBe(true);

    // Step 3: Alpha should see migrated data
    const alphaContent = await getCurrentEntryContent(page);
    expect(alphaContent).toContain("GUEST-UNIQUE");

    // Step 4: Alpha logs out with clear data
    await logout(page, true);

    // Step 5: Login as Beta (new user)
    const betaLogin = await devLogin(page, betaId);
    expect(betaLogin.isNewUser).toBe(true);

    // Step 6: Beta should see EMPTY (not Alpha's migrated data)
    const betaContent = await getCurrentEntryContent(page);
    expect(betaContent).toBeNull();

    // Verify "No previous entries" message
    await expect(page.getByText("No previous entries in the stack.")).toBeVisible();
  });

  /**
   * Scenario 1b: User Isolation After Migration
   *
   * After migration, each user's data should be completely isolated.
   */
  test("user-isolation-after-migration: users have isolated data after migration", async ({
    page,
  }) => {
    const alphaId = `test-alpha-isolation-${Date.now()}`;
    const betaId = `test-beta-isolation-${Date.now()}`;
    const guestContent = `GUEST-${Date.now()}`;
    const alphaContent = `ALPHA-ONLY-${Date.now()}`;
    const betaContent = `BETA-ONLY-${Date.now()}`;

    // Guest creates entry
    await createEntry(page, guestContent);

    // Alpha logs in (new user) - gets migrated data
    await devLogin(page, alphaId);

    // Alpha adds more content (edit their entry)
    await createEntry(page, alphaContent);

    // Alpha logs out (keep local data)
    await logout(page, false);

    // Beta logs in (new user) - should see empty
    await devLogin(page, betaId);
    let content = await getCurrentEntryContent(page);
    expect(content).toBeNull();

    // Beta creates their own entry
    await createEntry(page, betaContent);

    // Beta logs out (keep local data)
    await logout(page, false);

    // Alpha logs back in - should see ONLY Alpha's data
    await devLogin(page, alphaId);
    content = await getCurrentEntryContent(page);
    expect(content).toContain("ALPHA-ONLY");
    expect(content).not.toContain("BETA-ONLY");

    // Logout Alpha
    await logout(page, false);

    // Beta logs back in - should see ONLY Beta's data
    await devLogin(page, betaId);
    content = await getCurrentEntryContent(page);
    expect(content).toContain("BETA-ONLY");
    expect(content).not.toContain("ALPHA-ONLY");
  });
});

test.describe("User Isolation - Old User Scenario", () => {
  // These tests involve service worker operations which can be slow
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    // Clear all IndexedDB data for clean state
    await page.goto("/");
    await clearAllIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(2000);
  });

  /**
   * Scenario 2: Old User Login
   *
   * 1. Create an existing user (Alpha) with data first
   * 2. Alpha logs out
   * 3. Guest creates a NEW entry
   * 4. Alpha (old user) logs back in → sees ONLY their data, NOT guest's
   * 5. Alpha logs out
   * 6. Guest data should be PRESERVED
   */
  test("old-user-login: old user sees only their data, guest data preserved", async ({ page }) => {
    const alphaId = `test-old-alpha-${Date.now()}`;
    const alphaContent = `ALPHA-ORIGINAL-${Date.now()}: Alpha's data`;
    const guestContent = `GUEST-NEW-${Date.now()}: Should not appear for old users`;

    // Step 1: Create Alpha as a user first (with their own data)
    await devLogin(page, alphaId);
    await createEntry(page, alphaContent);

    // Verify Alpha's entry was created
    let content = await getCurrentEntryContent(page);
    expect(content).toContain("ALPHA-ORIGINAL");

    // Step 2: Alpha logs out (keep local data for offline access)
    await logout(page, false);

    // Step 3: Guest creates a NEW entry
    await createEntry(page, guestContent);

    // Verify guest entry exists
    content = await getCurrentEntryContent(page);
    expect(content).toContain("GUEST-NEW");

    // Step 4: Alpha (OLD user) logs back in
    const alphaLogin = await devLogin(page, alphaId);
    expect(alphaLogin.isNewUser).toBe(false); // Should be OLD user

    // Alpha should see ONLY their original data
    content = await getCurrentEntryContent(page);
    expect(content).toContain("ALPHA-ORIGINAL");
    expect(content).not.toContain("GUEST-NEW");

    // Step 5: Alpha logs out (keep local data)
    await logout(page, false);

    // Step 6: Guest data should still be PRESERVED
    content = await getCurrentEntryContent(page);
    expect(content).toContain("GUEST-NEW");
    expect(content).not.toContain("ALPHA-ORIGINAL");
  });

  /**
   * Scenario 2b: Multiple old users don't interfere with each other or guest
   */
  test("multiple-old-users: old users have isolated data, guest data preserved", async ({
    page,
  }) => {
    const alphaId = `test-multi-alpha-${Date.now()}`;
    const betaId = `test-multi-beta-${Date.now()}`;
    const alphaContent = `ALPHA-DATA-${Date.now()}`;
    const betaContent = `BETA-DATA-${Date.now()}`;
    const guestContent = `GUEST-DATA-${Date.now()}`;

    // Create Alpha with data
    await devLogin(page, alphaId);
    await createEntry(page, alphaContent);
    await logout(page, false);

    // Create Beta with data
    await devLogin(page, betaId);
    await createEntry(page, betaContent);
    await logout(page, false);

    // Guest creates data
    await createEntry(page, guestContent);

    // Verify guest sees their data
    let content = await getCurrentEntryContent(page);
    expect(content).toContain("GUEST-DATA");

    // Alpha logs in - sees ONLY Alpha's data
    await devLogin(page, alphaId);
    content = await getCurrentEntryContent(page);
    expect(content).toContain("ALPHA-DATA");
    expect(content).not.toContain("BETA-DATA");
    expect(content).not.toContain("GUEST-DATA");
    await logout(page, false);

    // Beta logs in - sees ONLY Beta's data
    await devLogin(page, betaId);
    content = await getCurrentEntryContent(page);
    expect(content).toContain("BETA-DATA");
    expect(content).not.toContain("ALPHA-DATA");
    expect(content).not.toContain("GUEST-DATA");
    await logout(page, false);

    // Guest data should STILL be there
    content = await getCurrentEntryContent(page);
    expect(content).toContain("GUEST-DATA");
    expect(content).not.toContain("ALPHA-DATA");
    expect(content).not.toContain("BETA-DATA");
  });
});

test.describe("User Isolation - Edge Cases", () => {
  // These tests involve service worker operations which can be slow
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAllIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(2000);
  });

  /**
   * Edge case: Login with clear data should not affect other users
   */
  test("clear-data-isolation: clearing one user's data doesn't affect others", async ({ page }) => {
    const alphaId = `test-clear-alpha-${Date.now()}`;
    const betaId = `test-clear-beta-${Date.now()}`;
    const alphaContent = `ALPHA-CLEAR-${Date.now()}`;
    const betaContent = `BETA-CLEAR-${Date.now()}`;

    // Create Alpha with data
    await devLogin(page, alphaId);
    await createEntry(page, alphaContent);
    await logout(page, false);

    // Create Beta with data
    await devLogin(page, betaId);
    await createEntry(page, betaContent);

    // Beta logs out WITH clear data
    await logout(page, true);

    // Alpha logs in - should STILL have their data
    await devLogin(page, alphaId);
    const content = await getCurrentEntryContent(page);
    expect(content).toContain("ALPHA-CLEAR");
  });

  /**
   * Edge case: Rapid login/logout cycles should maintain isolation
   */
  test("rapid-switch-isolation: rapid user switching maintains isolation", async ({ page }) => {
    const alphaId = `test-rapid-alpha-${Date.now()}`;
    const betaId = `test-rapid-beta-${Date.now()}`;
    const alphaContent = `ALPHA-RAPID-${Date.now()}`;
    const betaContent = `BETA-RAPID-${Date.now()}`;

    // Create both users with data
    await devLogin(page, alphaId);
    await createEntry(page, alphaContent);
    await logout(page, false);

    await devLogin(page, betaId);
    await createEntry(page, betaContent);
    await logout(page, false);

    // Rapid switching - 3 cycles
    for (let i = 0; i < 3; i++) {
      await devLogin(page, alphaId);
      let content = await getCurrentEntryContent(page);
      expect(content).toContain("ALPHA-RAPID");
      expect(content).not.toContain("BETA-RAPID");
      await logout(page, false);

      await devLogin(page, betaId);
      content = await getCurrentEntryContent(page);
      expect(content).toContain("BETA-RAPID");
      expect(content).not.toContain("ALPHA-RAPID");
      await logout(page, false);
    }
  });
});
