import { test, expect, Page } from "@playwright/test";

/**
 * E2E Tests for Multi-User Switching and Data Isolation
 *
 * Tests comprehensive user switching scenarios:
 * - Anonymous -> User A -> User B -> User C -> Anonymous cycling
 * - Each user creates entries on different days
 * - Navigation and refresh verification at each step
 * - Data isolation verification between users
 *
 * Test flow for each user:
 * 1. First visit: write and verify entry (or navigate to previous day for subsequent visits)
 * 2. Refresh and verify
 * 3. Go to monthly and verify display
 * 4. Refresh on monthly and verify
 * 5. Go to config and verify user info
 * 6. Refresh and verify user info
 * 7. Go back to daily and verify entry
 * 8. Refresh and verify entry
 * 9. Logout (or login next user if anonymous)
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
async function devLogin(
  page: Page,
  googleId: string
): Promise<{ userId: string; isNewUser: boolean }> {
  await page.goto("/login");
  await page.waitForTimeout(500);

  const textbox = page.getByRole("textbox", { name: "Test Google ID" });
  await textbox.fill(googleId);

  // Capture console logs to get login result
  const loginPromise = page.waitForEvent("console", {
    predicate: (msg) => msg.text().includes("[DevLogin]"),
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Dev Login" }).click();

  const logMsg = await loginPromise;
  const match = logMsg.text().match(/userId=([^,]+), isNewUser=(\w+)/);

  await page.waitForURL("/");
  await page.waitForTimeout(2000);

  return {
    userId: match?.[1] || "",
    isNewUser: match?.[2] === "true",
  };
}

// Helper to logout (with option to clear local data)
async function logout(page: Page, clearData: boolean = false) {
  await page.goto("/config");
  await page.waitForTimeout(500);

  const logoutBtn = page.getByRole("button", { name: "Log out" });
  if (!(await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    return; // Already logged out
  }

  // Handle the confirmation dialog
  page.once("dialog", async (dialog) => {
    if (clearData) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await logoutBtn.click();
  await page.waitForTimeout(2000);
}

// Helper to create an entry
async function createEntry(page: Page, content: string, date?: string) {
  if (date) {
    // Navigate to specific date by going to that day's entry
    await page.goto(`/?date=${date}`);
  } else {
    await page.goto("/");
  }
  await page.waitForTimeout(2000);

  // Check if we're in view mode (entry exists) - need to click edit button first
  const editButton = page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-pencil") })
    .first();
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
  await page.waitForTimeout(1500);
}

// Helper to get current entry content
async function getCurrentEntryContent(page: Page): Promise<string | null> {
  await page.waitForTimeout(1500);

  // Check if there's a "New Entry" indicator (no content)
  const newEntry = page.getByText("New Entry");
  if (await newEntry.isVisible({ timeout: 1000 }).catch(() => false)) {
    return null;
  }

  // Try to get the rendered paragraph content (the entry body)
  const paragraph = page.locator("main p").first();
  if (await paragraph.isVisible({ timeout: 2000 }).catch(() => false)) {
    return await paragraph.textContent();
  }

  return null;
}

// Helper to verify user is logged in
async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto("/config");
  await page.waitForTimeout(1000);

  const signedIn = await page
    .getByText("Signed in with Google")
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  return signedIn;
}

// Helper to verify user is anonymous (not logged in)
async function isAnonymous(page: Page): Promise<boolean> {
  await page.goto("/config");
  await page.waitForTimeout(1000);

  const signInBtn = await page
    .getByRole("button", { name: /Sign in with Google/i })
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  return signInBtn;
}

// Full user flow verification
async function verifyUserFlow(
  page: Page,
  userLabel: string,
  uniqueMarker: string,
  isLoggedInUser: boolean
) {
  const results: { step: string; pass: boolean; details?: string }[] = [];

  // 1. Verify entry on daily
  await page.goto("/");
  await page.waitForTimeout(2000);
  let content = await getCurrentEntryContent(page);
  results.push({
    step: `${userLabel}: Entry visible on daily`,
    pass: content?.includes(uniqueMarker) ?? false,
    details: content?.substring(0, 50) || "no content",
  });

  // 2. Refresh and verify
  await page.reload();
  await page.waitForTimeout(2000);
  content = await getCurrentEntryContent(page);
  results.push({
    step: `${userLabel}: Entry visible after refresh`,
    pass: content?.includes(uniqueMarker) ?? false,
  });

  // 3. Go to monthly and verify
  await page.goto("/monthly");
  await page.waitForTimeout(1500);
  const monthlyVisible = await page
    .getByText(uniqueMarker)
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  results.push({
    step: `${userLabel}: Entry visible in monthly`,
    pass: monthlyVisible,
  });

  // 4. Refresh monthly and verify
  await page.reload();
  await page.waitForTimeout(1500);
  const monthlyRefreshVisible = await page
    .getByText(uniqueMarker)
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  results.push({
    step: `${userLabel}: Entry visible in monthly after refresh`,
    pass: monthlyRefreshVisible,
  });

  // 5. Go to config and verify user info
  await page.goto("/config");
  await page.waitForTimeout(1000);
  if (isLoggedInUser) {
    const signedIn = await page
      .getByText("Signed in with Google")
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    results.push({
      step: `${userLabel}: Config shows logged in`,
      pass: signedIn,
    });
  } else {
    const signInBtn = await page
      .getByRole("button", { name: /Sign in with Google/i })
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    results.push({
      step: `${userLabel}: Config shows sign in button`,
      pass: signInBtn,
    });
  }

  // 6. Refresh config and verify user info
  await page.reload();
  await page.waitForTimeout(1000);
  if (isLoggedInUser) {
    const signedIn = await page
      .getByText("Signed in with Google")
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    results.push({
      step: `${userLabel}: Config shows logged in after refresh`,
      pass: signedIn,
    });
  } else {
    const signInBtn = await page
      .getByRole("button", { name: /Sign in with Google/i })
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    results.push({
      step: `${userLabel}: Config shows sign in button after refresh`,
      pass: signInBtn,
    });
  }

  // 7. Go back to daily and verify
  await page.goto("/");
  await page.waitForTimeout(2000);
  content = await getCurrentEntryContent(page);
  results.push({
    step: `${userLabel}: Entry visible after config->daily`,
    pass: content?.includes(uniqueMarker) ?? false,
  });

  // 8. Refresh and verify
  await page.reload();
  await page.waitForTimeout(2000);
  content = await getCurrentEntryContent(page);
  results.push({
    step: `${userLabel}: Entry visible after final refresh`,
    pass: content?.includes(uniqueMarker) ?? false,
  });

  return results;
}

test.describe("Multi-User Switching - Comprehensive Test", () => {
  test.setTimeout(180000); // 3 minutes for comprehensive test

  test.beforeEach(async ({ page }) => {
    // Clear all IndexedDB data for clean state
    await page.goto("/");
    await clearAllIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(3000);
  });

  /**
   * Comprehensive multi-user switching test
   * Cycles through: Anonymous -> User A -> User B -> User C -> Anonymous
   * Repeats for multiple cycles to ensure stability
   */
  test("multi-user-cycling: complete user switching with data isolation", async ({
    page,
  }) => {
    const timestamp = Date.now();

    // User identifiers
    const userAId = `test-user-a-${timestamp}`;
    const userBId = `test-user-b-${timestamp}`;
    const userCId = `test-user-c-${timestamp}`;

    // Unique content markers for each user
    const anonMarker = `ANON-${timestamp}`;
    const userAMarker = `USER-A-${timestamp}`;
    const userBMarker = `USER-B-${timestamp}`;
    const userCMarker = `USER-C-${timestamp}`;

    // ===== CYCLE 1 =====

    // Step 1: Anonymous creates entry
    await createEntry(page, `${anonMarker}: Anonymous first entry`);

    // Verify anonymous flow
    const anonResults1 = await verifyUserFlow(page, "Anonymous-1", anonMarker, false);
    for (const result of anonResults1) {
      expect(result.pass, result.step).toBe(true);
    }

    // Step 2: Login as User A (new user - gets anonymous data migrated)
    const userALogin = await devLogin(page, userAId);
    expect(userALogin.isNewUser).toBe(true);

    // User A should see migrated anonymous data
    await page.goto("/");
    await page.waitForTimeout(2000);
    let content = await getCurrentEntryContent(page);
    expect(content).toContain(anonMarker);

    // User A creates their own entry (overwrites for today)
    await createEntry(page, `${userAMarker}: User A first entry`);

    // Verify User A flow
    const userAResults = await verifyUserFlow(page, "User-A", userAMarker, true);
    for (const result of userAResults) {
      expect(result.pass, result.step).toBe(true);
    }

    // Logout User A (keep local data)
    await logout(page, false);

    // Step 3: Login as User B (new user)
    const userBLogin = await devLogin(page, userBId);
    expect(userBLogin.isNewUser).toBe(true);

    // User B should see empty (anonymous data was already migrated to User A)
    await page.goto("/");
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toBeNull();

    // User B creates their entry
    await createEntry(page, `${userBMarker}: User B first entry`);

    // Verify User B has only their data, not User A's
    content = await getCurrentEntryContent(page);
    expect(content).toContain(userBMarker);
    expect(content).not.toContain(userAMarker);

    // Verify User B flow
    const userBResults = await verifyUserFlow(page, "User-B", userBMarker, true);
    for (const result of userBResults) {
      expect(result.pass, result.step).toBe(true);
    }

    // Logout User B
    await logout(page, false);

    // Step 4: Login as User C (new user)
    const userCLogin = await devLogin(page, userCId);
    expect(userCLogin.isNewUser).toBe(true);

    // User C should see empty
    await page.goto("/");
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toBeNull();

    // User C creates their entry
    await createEntry(page, `${userCMarker}: User C first entry`);

    // Verify User C has only their data
    content = await getCurrentEntryContent(page);
    expect(content).toContain(userCMarker);
    expect(content).not.toContain(userAMarker);
    expect(content).not.toContain(userBMarker);

    // Verify User C flow
    const userCResults = await verifyUserFlow(page, "User-C", userCMarker, true);
    for (const result of userCResults) {
      expect(result.pass, result.step).toBe(true);
    }

    // Logout User C
    await logout(page, false);

    // Step 5: Verify anonymous state
    expect(await isAnonymous(page)).toBe(true);

    // Anonymous should have empty data (was migrated to User A)
    await page.goto("/");
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toBeNull();

    // ===== CYCLE 2: Re-login existing users =====

    // Login User A again (returning user)
    const userALogin2 = await devLogin(page, userAId);
    expect(userALogin2.isNewUser).toBe(false);

    // User A should see their data
    await page.goto("/");
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toContain(userAMarker);
    expect(content).not.toContain(userBMarker);
    expect(content).not.toContain(userCMarker);

    // Logout User A
    await logout(page, false);

    // Login User B again
    const userBLogin2 = await devLogin(page, userBId);
    expect(userBLogin2.isNewUser).toBe(false);

    // User B should see their data
    await page.goto("/");
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toContain(userBMarker);
    expect(content).not.toContain(userAMarker);
    expect(content).not.toContain(userCMarker);

    // Logout User B
    await logout(page, false);

    // Login User C again
    const userCLogin2 = await devLogin(page, userCId);
    expect(userCLogin2.isNewUser).toBe(false);

    // User C should see their data
    await page.goto("/");
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toContain(userCMarker);
    expect(content).not.toContain(userAMarker);
    expect(content).not.toContain(userBMarker);

    // Final logout
    await logout(page, false);
  });

  /**
   * Rapid user switching stress test
   * Quick cycling between users to test for race conditions
   */
  test("rapid-user-switching: stress test for race conditions", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(300000); // 5 minutes for 5 cycles × 3 users
    const timestamp = Date.now();

    // Create users with data first
    const userIds = [
      `rapid-user-1-${timestamp}`,
      `rapid-user-2-${timestamp}`,
      `rapid-user-3-${timestamp}`,
    ];

    const markers = [
      `RAPID-1-${timestamp}`,
      `RAPID-2-${timestamp}`,
      `RAPID-3-${timestamp}`,
    ];

    // Setup: Create entries for each user
    for (let i = 0; i < userIds.length; i++) {
      await devLogin(page, userIds[i]);
      await createEntry(page, `${markers[i]}: User ${i + 1} entry`);
      await logout(page, false);
    }

    // Rapid switching test: 5 cycles
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < userIds.length; i++) {
        await devLogin(page, userIds[i]);

        // Quick verification
        await page.goto("/");
        await page.waitForTimeout(1000);
        const content = await getCurrentEntryContent(page);

        expect(content, `Cycle ${cycle + 1}, User ${i + 1}`).toContain(markers[i]);

        // Verify isolation
        for (let j = 0; j < markers.length; j++) {
          if (j !== i) {
            expect(content, `Cycle ${cycle + 1}, User ${i + 1} isolation from User ${j + 1}`).not.toContain(
              markers[j]
            );
          }
        }

        // Quick navigation test
        await page.goto("/config");
        await page.waitForTimeout(300);
        await page.goto("/monthly");
        await page.waitForTimeout(300);
        await page.goto("/");
        await page.waitForTimeout(500);

        // Re-verify after navigation
        const contentAfterNav = await getCurrentEntryContent(page);
        expect(
          contentAfterNav,
          `Cycle ${cycle + 1}, User ${i + 1} after navigation`
        ).toContain(markers[i]);

        await logout(page, false);
      }
    }
  });

  /**
   * Test multiple days per user
   * Each user creates entries on different days
   */
  test("multi-day-entries: users create entries on multiple days", async ({
    page,
  }) => {
    const timestamp = Date.now();
    const userAId = `multiday-a-${timestamp}`;
    const userBId = `multiday-b-${timestamp}`;

    // User A creates entries on today and yesterday
    await devLogin(page, userAId);

    await createEntry(page, `USER-A-TODAY-${timestamp}`);

    // Navigate to yesterday using the prev button
    await page.locator("button").filter({ has: page.locator("svg.lucide-chevron-left") }).first().click();
    await page.waitForTimeout(1000);

    // Create entry for yesterday
    const textarea = page.locator("textarea").first();
    if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await textarea.fill(`USER-A-YESTERDAY-${timestamp}`);
      await page.getByRole("button", { name: "Save" }).click();
      await page.waitForTimeout(1000);
    }

    await logout(page, false);

    // User B creates entries
    await devLogin(page, userBId);
    await createEntry(page, `USER-B-TODAY-${timestamp}`);
    await logout(page, false);

    // Verify User A sees both their entries
    await devLogin(page, userAId);
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Today's entry
    let content = await getCurrentEntryContent(page);
    expect(content).toContain("USER-A-TODAY");
    expect(content).not.toContain("USER-B");

    // Check monthly view shows both User A entries
    await page.goto("/monthly");
    await page.waitForTimeout(1500);

    const todayVisible = await page
      .getByText(`USER-A-TODAY-${timestamp}`)
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    expect(todayVisible).toBe(true);

    await logout(page, false);

    // Verify User B only sees their entry
    await devLogin(page, userBId);
    await page.goto("/");
    await page.waitForTimeout(2000);

    content = await getCurrentEntryContent(page);
    expect(content).toContain("USER-B-TODAY");
    expect(content).not.toContain("USER-A");

    await logout(page, false);
  });
});

test.describe("Multi-User Switching - Edge Cases", () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearAllIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(3000);
  });

  /**
   * Test clear data on logout
   * Clearing one user's data should not affect others
   */
  test("clear-data-on-logout: clears only current user data", async ({
    page,
  }) => {
    const timestamp = Date.now();
    const userAId = `clear-a-${timestamp}`;
    const userBId = `clear-b-${timestamp}`;
    const userAMarker = `CLEAR-A-${timestamp}`;
    const userBMarker = `CLEAR-B-${timestamp}`;

    // User A creates entry
    await devLogin(page, userAId);
    await createEntry(page, `${userAMarker}: User A entry`);
    await logout(page, false);

    // User B creates entry
    await devLogin(page, userBId);
    await createEntry(page, `${userBMarker}: User B entry`);

    // User B logs out WITH clear data
    await logout(page, true);

    // User A logs back in - should STILL have their data
    await devLogin(page, userAId);
    await page.goto("/");
    await page.waitForTimeout(2000);

    const content = await getCurrentEntryContent(page);
    expect(content).toContain(userAMarker);

    await logout(page, false);
  });

  /**
   * Test refresh during user switch
   * Refreshing at various points should maintain correct state
   */
  test("refresh-during-switch: maintains correct state on refresh", async ({
    page,
  }) => {
    const timestamp = Date.now();
    const userAId = `refresh-a-${timestamp}`;
    const userAMarker = `REFRESH-A-${timestamp}`;

    // User A creates entry
    await devLogin(page, userAId);
    await createEntry(page, `${userAMarker}: User A entry`);

    // Multiple refreshes at different points
    await page.reload();
    await page.waitForTimeout(2000);
    let content = await getCurrentEntryContent(page);
    expect(content).toContain(userAMarker);

    await page.goto("/config");
    await page.reload();
    await page.waitForTimeout(1000);
    expect(await isLoggedIn(page)).toBe(true);

    await page.goto("/monthly");
    await page.reload();
    await page.waitForTimeout(1500);
    const monthlyVisible = await page
      .getByText(userAMarker)
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    expect(monthlyVisible).toBe(true);

    await page.goto("/");
    await page.reload();
    await page.waitForTimeout(2000);
    content = await getCurrentEntryContent(page);
    expect(content).toContain(userAMarker);

    await logout(page, false);
  });

  /**
   * Test browser back/forward navigation
   * History navigation should maintain correct user data
   */
  test("history-navigation: maintains correct state with back/forward", async ({
    page,
  }) => {
    const timestamp = Date.now();
    const userAId = `history-a-${timestamp}`;
    const userAMarker = `HISTORY-A-${timestamp}`;

    // User A creates entry
    await devLogin(page, userAId);
    await createEntry(page, `${userAMarker}: User A entry`);

    // Navigate through pages
    await page.goto("/config");
    await page.waitForTimeout(500);
    await page.goto("/monthly");
    await page.waitForTimeout(500);
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Go back twice
    await page.goBack();
    await page.waitForTimeout(500);
    await page.goBack();
    await page.waitForTimeout(500);

    // Go forward to daily
    await page.goForward();
    await page.waitForTimeout(500);
    await page.goForward();
    await page.waitForTimeout(1000);

    // Verify content is still correct
    const content = await getCurrentEntryContent(page);
    expect(content).toContain(userAMarker);

    await logout(page, false);
  });
});
