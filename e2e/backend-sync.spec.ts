import { test, expect, Page } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Backend DB Sync Verification Tests
 *
 * Directly queries the SQLite backend to verify:
 * 1. Anonymous user data does NOT reach backend
 * 2. Logged-in user data DOES sync to backend
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, "../apps/api/data/local.db");

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

// Helper to perform dev login
async function devLogin(page: Page, googleId: string): Promise<boolean> {
  await page.goto("/login");
  await page.waitForTimeout(1000);

  const devInput = page.getByPlaceholder("e.g., test-user-123");
  if (!(await devInput.isVisible().catch(() => false))) {
    console.log("Dev login not available");
    return false;
  }

  await devInput.fill(googleId);
  const devLoginButton = page.getByRole("button", { name: "Dev Login" });
  await devLoginButton.click();

  try {
    await page.waitForURL("/", { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.goto("/config");
    await page.waitForTimeout(1000);

    const logoutButton = page.getByRole("button", { name: "Log out" });
    return await logoutButton.isVisible({ timeout: 3000 }).catch(() => false);
  } catch {
    return false;
  }
}

// Helper to create an entry via UI
async function createEntry(page: Page, content: string) {
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 5000 });
  await textarea.fill(content);

  const saveButton = page.getByRole("button", { name: "Save" });
  await saveButton.click();
  await page.waitForTimeout(500);
}

// Helper to run sqlite3 query and parse JSON output
function runSqliteQuery(query: string): string {
  try {
    const result = execSync(`sqlite3 -json "${DB_PATH}" "${query}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    return result.trim();
  } catch {
    return "[]";
  }
}

// Helper to query backend DB for entries by user
function getEntriesByUserId(userId: string): Array<{ date: string; content: string; user_id: string }> {
  const query = `SELECT date, content, user_id FROM entries WHERE user_id = '${userId}'`;
  const result = runSqliteQuery(query);
  try {
    return JSON.parse(result || "[]");
  } catch {
    return [];
  }
}

// Helper to query backend DB for entries by content pattern
function getEntriesByContent(pattern: string): Array<{ date: string; content: string; user_id: string }> {
  const query = `SELECT date, content, user_id FROM entries WHERE content LIKE '%${pattern}%'`;
  const result = runSqliteQuery(query);
  try {
    return JSON.parse(result || "[]");
  } catch {
    return [];
  }
}

// Helper to delete test entries from backend
function deleteTestEntries(pattern: string) {
  const query = `DELETE FROM entries WHERE content LIKE '%${pattern}%'`;
  try {
    execSync(`sqlite3 "${DB_PATH}" "${query}"`, { encoding: "utf-8", timeout: 10000 });
    console.log(`Deleted test entries matching: ${pattern}`);
  } catch (e) {
    console.log("Delete failed:", e);
  }
}

// Helper to get user by google_id (dev login adds 'dev_' prefix)
function getUserByGoogleId(googleId: string): { id: string; google_id: string } | undefined {
  // Try with dev_ prefix first (for dev login)
  const devQuery = `SELECT id, google_id FROM users WHERE google_id = 'dev_${googleId}'`;
  let result = runSqliteQuery(devQuery);
  try {
    const users = JSON.parse(result || "[]");
    if (users.length > 0) return users[0];
  } catch {
    // continue
  }

  // Try without prefix
  const query = `SELECT id, google_id FROM users WHERE google_id = '${googleId}'`;
  result = runSqliteQuery(query);
  try {
    const users = JSON.parse(result || "[]");
    return users[0];
  } catch {
    return undefined;
  }
}

test.describe("Backend DB Sync Verification", () => {
  const TEST_MARKER = `BACKEND_SYNC_TEST_${Date.now()}`;

  test.afterAll(() => {
    // Cleanup test entries from backend
    deleteTestEntries(TEST_MARKER);
  });

  /**
   * Test: Anonymous user data does NOT reach backend
   */
  test("anonymous user entries do NOT sync to backend", async ({ page }) => {
    // Clear local state
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Create entry as anonymous user
    const anonContent = `ANON_${TEST_MARKER}_${Date.now()}`;
    await createEntry(page, anonContent);

    // Verify entry appears in UI
    await expect(page.getByText(anonContent.substring(0, 20))).toBeVisible();

    // Wait a bit for any potential sync
    await page.waitForTimeout(3000);

    // Query backend DB - should NOT find this entry
    const backendEntries = getEntriesByContent(anonContent);
    console.log(`Backend entries with anonymous content: ${backendEntries.length}`);

    expect(backendEntries.length).toBe(0);
  });

  /**
   * Test: Logged-in user data DOES sync to backend
   */
  test("logged-in user entries DO sync to backend", async ({ page }) => {
    const userId = `backend-test-${Date.now()}`;

    // Clear local state
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Login
    const loginSuccess = await devLogin(page, userId);
    if (!loginSuccess) {
      test.skip();
      return;
    }

    // Navigate to home
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Create entry as logged-in user
    const userContent = `USER_${TEST_MARKER}_${Date.now()}`;
    await createEntry(page, userContent);

    // Verify entry appears in UI
    await expect(page.getByText(userContent.substring(0, 20))).toBeVisible();

    // Trigger explicit sync
    await page.goto("/config");
    await page.waitForTimeout(1000);

    const syncButton = page.locator("button[title='Sync now']");
    if (await syncButton.isVisible().catch(() => false)) {
      await syncButton.click();
      await page.waitForTimeout(5000);
    }

    // Query backend DB - should find this entry
    const backendEntries = getEntriesByContent(userContent);
    console.log(`Backend entries with user content: ${backendEntries.length}`);
    console.log("Found entries:", backendEntries);

    expect(backendEntries.length).toBeGreaterThan(0);

    // Verify the entry has the correct user ID
    const user = getUserByGoogleId(userId);
    if (user) {
      const userEntries = backendEntries.filter((e) => e.user_id === user.id);
      expect(userEntries.length).toBeGreaterThan(0);
    }
  });

  /**
   * Test: Anonymous data migrates to user on login and syncs to backend
   */
  test("anonymous data migrates to user and syncs to backend on login", async ({ page }) => {
    const userId = `migrate-test-${Date.now()}`;

    // Clear local state
    await page.goto("/");
    await clearIndexedDB(page);
    await page.reload();
    await page.waitForTimeout(1500);

    // Create entry as anonymous user FIRST
    const anonContent = `MIGRATE_${TEST_MARKER}_${Date.now()}`;
    await createEntry(page, anonContent);

    // Verify entry appears in UI
    await expect(page.getByText(anonContent.substring(0, 20))).toBeVisible();

    // Verify NOT in backend yet
    const beforeLogin = getEntriesByContent(anonContent);
    expect(beforeLogin.length).toBe(0);

    // Login as NEW user (triggers migration)
    const loginSuccess = await devLogin(page, userId);
    if (!loginSuccess) {
      test.skip();
      return;
    }

    // Navigate to home to verify entry was migrated
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Check if entry is visible (migrated to user namespace)
    const entryVisible = await page.getByText(anonContent.substring(0, 20)).isVisible().catch(() => false);
    console.log(`Entry visible after login: ${entryVisible}`);

    // Edit the entry to mark it as dirty (needs sync)
    if (entryVisible) {
      const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click();
        await page.waitForTimeout(300);

        // Append text to trigger update
        const textarea = page.locator("textarea").first();
        await textarea.fill(anonContent + " UPDATED");

        const saveButton = page.getByRole("button", { name: "Save" });
        await saveButton.click();
        await page.waitForTimeout(500);
      }
    }

    // Trigger explicit sync from config page
    await page.goto("/config");
    await page.waitForTimeout(1000);

    const syncButton = page.locator("button[title='Sync now']");
    if (await syncButton.isVisible().catch(() => false)) {
      await syncButton.click();
      await page.waitForTimeout(5000);
    }

    // Query backend DB - should find migrated entry
    const afterLogin = getEntriesByContent(anonContent);
    console.log(`Backend entries after login/migration: ${afterLogin.length}`);
    console.log("Found entries:", afterLogin);
    console.log(`Entry was visible in UI: ${entryVisible}`);

    expect(afterLogin.length).toBeGreaterThan(0);

    // Verify entry belongs to the logged-in user
    const user = getUserByGoogleId(userId);
    if (user) {
      const userEntries = afterLogin.filter((e) => e.user_id === user.id);
      console.log(`Entries belonging to user ${user.id}: ${userEntries.length}`);
      expect(userEntries.length).toBeGreaterThan(0);
    }
  });

  /**
   * Test: Multiple users have separate data in backend
   */
  test("multiple users have isolated data in backend", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const user1 = `isolation-user1-${Date.now()}`;
    const user2 = `isolation-user2-${Date.now()}`;

    try {
      // User 1: Clear, login, create entry
      await page1.goto("/");
      await clearIndexedDB(page1);
      await page1.reload();
      await page1.waitForTimeout(1500);

      const login1 = await devLogin(page1, user1);
      if (!login1) {
        test.skip();
        return;
      }

      await page1.goto("/");
      await page1.waitForTimeout(1000);

      const content1 = `USER1_${TEST_MARKER}_${Date.now()}`;
      await createEntry(page1, content1);

      // Sync user1
      await page1.goto("/config");
      await page1.waitForTimeout(1000);
      const syncButton1 = page1.locator("button[title='Sync now']");
      if (await syncButton1.isVisible().catch(() => false)) {
        await syncButton1.click();
        await page1.waitForTimeout(3000);
      }

      // User 2: Clear, login, create entry
      await page2.goto("/");
      await clearIndexedDB(page2);
      await page2.reload();
      await page2.waitForTimeout(1500);

      const login2 = await devLogin(page2, user2);
      if (!login2) {
        test.skip();
        return;
      }

      await page2.goto("/");
      await page2.waitForTimeout(1000);

      const content2 = `USER2_${TEST_MARKER}_${Date.now()}`;
      await createEntry(page2, content2);

      // Sync user2
      await page2.goto("/config");
      await page2.waitForTimeout(1000);
      const syncButton2 = page2.locator("button[title='Sync now']");
      if (await syncButton2.isVisible().catch(() => false)) {
        await syncButton2.click();
        await page2.waitForTimeout(3000);
      }

      // Verify in backend
      const dbUser1 = getUserByGoogleId(user1);
      const dbUser2 = getUserByGoogleId(user2);

      expect(dbUser1).toBeDefined();
      expect(dbUser2).toBeDefined();

      if (dbUser1 && dbUser2) {
        const entries1 = getEntriesByUserId(dbUser1.id);
        const entries2 = getEntriesByUserId(dbUser2.id);

        console.log(`User1 entries in backend: ${entries1.length}`);
        console.log(`User2 entries in backend: ${entries2.length}`);

        // Each user should have their own entry
        const user1HasContent1 = entries1.some((e) => e.content.includes("USER1_"));
        const user2HasContent2 = entries2.some((e) => e.content.includes("USER2_"));

        expect(user1HasContent1).toBeTruthy();
        expect(user2HasContent2).toBeTruthy();

        // User1 should NOT have user2's content and vice versa
        const user1HasContent2 = entries1.some((e) => e.content.includes("USER2_"));
        const user2HasContent1 = entries2.some((e) => e.content.includes("USER1_"));

        expect(user1HasContent2).toBeFalsy();
        expect(user2HasContent1).toBeFalsy();
      }
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
