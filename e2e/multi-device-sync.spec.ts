import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";

/**
 * E2E Tests for Multi-Device Sync
 *
 * These tests verify that:
 * 1. Same user on multiple devices sees synced data
 * 2. Changes on one device appear on another after sync
 * 3. Conflict resolution works with Last-Write-Wins (LWW)
 *
 * Uses two browser contexts to simulate two devices (e.g., mobile and PC)
 */

const DB_NAME = "til-stack-local";

// Helper to clear IndexedDB in a context
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

// Helper to perform dev login
async function devLogin(page: Page, googleId: string): Promise<void> {
  await page.goto("/login");
  await page.waitForTimeout(500);

  const textbox = page.getByRole("textbox", { name: "Test Google ID" });
  await textbox.fill(googleId);
  await page.getByRole("button", { name: "Dev Login" }).click();

  await page.waitForURL("/");
  await page.waitForTimeout(1500);
}

// Helper to logout
async function logout(page: Page, clearData: boolean = false) {
  await page.goto("/config");
  await page.waitForTimeout(500);

  page.once("dialog", async (dialog) => {
    if (clearData) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForTimeout(1000);
}

// Helper to create/edit an entry
async function createEntry(page: Page, content: string) {
  await page.goto("/");
  await page.waitForTimeout(1500);

  // Check if we're in view mode - need to click edit button first
  const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
  if (await editButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editButton.click();
    await page.waitForTimeout(500);
  }

  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await textarea.fill(content);

  const saveButton = page.getByRole("button", { name: "Save" });
  await saveButton.waitFor({ state: "visible", timeout: 5000 });
  await saveButton.click();
  await page.waitForTimeout(1000);
}

// Helper to trigger manual sync and wait for completion
async function triggerSync(page: Page) {
  await page.goto("/config");
  await page.waitForTimeout(1000);

  const syncButton = page.locator("button[title='Sync now']");
  if (await syncButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await syncButton.click();
    // Wait for "Syncing..." to appear and then disappear
    await page.waitForTimeout(3000);
  }

  // Go back home and wait for data to load
  await page.goto("/");
  await page.waitForTimeout(2000);
}

// Helper to get current entry content (always navigates to home fresh)
async function getCurrentEntryContent(page: Page): Promise<string | null> {
  await page.goto("/");
  await page.waitForTimeout(3000); // Wait for data to load

  // Check if there's a "New Entry" indicator (no content)
  const newEntry = page.getByText("New Entry");
  const newEntryVisible = await newEntry.isVisible({ timeout: 2000 }).catch(() => false);

  if (newEntryVisible) {
    return null;
  }

  // Find all paragraphs in main and look for entry content
  // Skip "No previous entries" paragraph
  const paragraphs = page.locator("main p");
  const count = await paragraphs.count();

  for (let i = 0; i < count; i++) {
    const p = paragraphs.nth(i);
    const text = await p.textContent();
    // Skip the "No previous entries" and "Stack" section paragraphs
    if (text && !text.includes("No previous entries") && !text.includes("Stack")) {
      return text;
    }
  }

  // Fallback: check for h1 content (markdown heading)
  const heading = page.locator("main h1").first();
  if (await heading.isVisible({ timeout: 1000 }).catch(() => false)) {
    const text = await heading.textContent();
    return text;
  }

  return null;
}

// Helper to reload and wait for service worker
async function reloadAndWait(page: Page) {
  await page.reload();
  await page.waitForTimeout(2000);
}

test.describe("Multi-Device Sync", () => {
  // These tests need longer timeouts for multiple sync operations
  test.setTimeout(120000);

  let browser: Browser;
  let device1Context: BrowserContext;
  let device2Context: BrowserContext;
  let device1Page: Page;
  let device2Page: Page;
  // Note: testUserId is now generated per-test to ensure isolation
  let testUserId: string;

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
  });

  test.beforeEach(async () => {
    // Generate unique userId per test to ensure complete isolation
    testUserId = `multi-device-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create two separate browser contexts (simulating two devices)
    device1Context = await browser.newContext();
    device2Context = await browser.newContext();

    device1Page = await device1Context.newPage();
    device2Page = await device2Context.newPage();

    // Clear IndexedDB in both contexts
    await device1Page.goto("/");
    await clearIndexedDB(device1Page);
    await device1Page.reload();
    await device1Page.waitForTimeout(2000);

    await device2Page.goto("/");
    await clearIndexedDB(device2Page);
    await device2Page.reload();
    await device2Page.waitForTimeout(2000);
  });

  test.afterEach(async () => {
    await device1Context?.close();
    await device2Context?.close();
  });

  /**
   * Scenario 1: Basic Multi-Device Sync
   *
   * 1. Device 1 logs in and creates entry
   * 2. Device 2 logs in as same user
   * 3. Device 2 should see Device 1's entry after sync
   */
  test("basic-sync: device 2 sees device 1 data after login", async () => {
    const entryContent = `DEVICE1-ENTRY-${Date.now()}: Created on Device 1`;

    // Device 1: Login and create entry
    await devLogin(device1Page, testUserId);
    await createEntry(device1Page, entryContent);

    // Verify Device 1 has the entry
    let content = await getCurrentEntryContent(device1Page);
    expect(content).toContain("DEVICE1-ENTRY");

    // Trigger sync on Device 1 to ensure it's pushed to server
    await triggerSync(device1Page);

    // Wait a bit for server to process
    await device1Page.waitForTimeout(2000);

    // Device 2: Login as same user (this should trigger a pull from server)
    await devLogin(device2Page, testUserId);

    // Wait for the initial pull to complete
    await device2Page.waitForTimeout(2000);

    // Explicitly trigger sync on Device 2 to make sure it pulls
    await triggerSync(device2Page);

    // Device 2 should see Device 1's entry
    content = await getCurrentEntryContent(device2Page);
    expect(content).toContain("DEVICE1-ENTRY");
  });

  /**
   * Scenario 2: Bidirectional Sync
   */
  test("bidirectional-sync: changes sync both ways", async () => {
    const entryA = `ENTRY-A-${Date.now()}: From Device 1`;
    const entryB = `ENTRY-B-${Date.now()}: Modified by Device 2`;

    // Device 1: Login and create entry A
    await devLogin(device1Page, testUserId);
    await createEntry(device1Page, entryA);
    await triggerSync(device1Page);

    // Device 2: Login and verify entry A
    await devLogin(device2Page, testUserId);
    let content = await getCurrentEntryContent(device2Page);
    expect(content).toContain("ENTRY-A");

    // Device 2: Modify to entry B
    await createEntry(device2Page, entryB);
    await triggerSync(device2Page);

    // Device 1: Sync and verify entry B
    await triggerSync(device1Page);
    await reloadAndWait(device1Page);

    content = await getCurrentEntryContent(device1Page);
    expect(content).toContain("ENTRY-B");
  });

  /**
   * Scenario 3: Conflict Resolution (Last-Push-Wins)
   *
   * The sync mechanism uses server-side timestamps (updatedAt is set by server on each push).
   * This means the device that pushes LAST to the server wins, regardless of local edit time.
   */
  test("conflict-resolution: last push to server wins", async () => {
    const initialEntry = `INITIAL-${Date.now()}`;
    const device1Edit = `DEVICE1-EDIT-${Date.now()}: Pushed first`;
    const device2Edit = `DEVICE2-EDIT-${Date.now()}: Pushed second (should win)`;

    // Both devices login
    await devLogin(device1Page, testUserId);
    await devLogin(device2Page, testUserId);

    // Device 1 creates initial entry and syncs
    await createEntry(device1Page, initialEntry);
    await triggerSync(device1Page);

    // Device 2 pulls the initial entry
    await triggerSync(device2Page);

    // Device 1 edits and pushes FIRST
    await createEntry(device1Page, device1Edit);
    await triggerSync(device1Page);

    // Wait to ensure sequential pushes
    await device2Page.waitForTimeout(1500);

    // Device 2 edits and pushes SECOND (this should win - last push wins)
    await createEntry(device2Page, device2Edit);
    await triggerSync(device2Page);

    // Wait for server to process
    await device1Page.waitForTimeout(1500);

    // Device 1 syncs to pull latest
    await triggerSync(device1Page);

    // Device 1 should now have Device 2's version (last push wins)
    const content = await getCurrentEntryContent(device1Page);
    expect(content).toContain("DEVICE2-EDIT");
    expect(content).toContain("should win");
  });

  /**
   * Scenario 4: Offline then Online Sync
   *
   * 1. Device 1 creates entry while "offline" (no sync)
   * 2. Device 2 creates different entry while "offline"
   */
  test("offline-online-sync: pending operations sync when online", async () => {
    const device1Entry = `OFFLINE-D1-${Date.now()}`;
    const device2Entry = `OFFLINE-D2-${Date.now()}`;

    // Both devices login
    await devLogin(device1Page, testUserId);
    await devLogin(device2Page, testUserId);

    // Device 1 creates entry (simulating offline by not syncing)
    await createEntry(device1Page, device1Entry);
    // Don't sync yet

    // Small delay
    await device2Page.waitForTimeout(500);

    // Device 2 creates entry (later timestamp)
    await createEntry(device2Page, device2Entry);

    // Now both sync (simulating coming online)
    await triggerSync(device1Page);
    await device1Page.waitForTimeout(500);
    await triggerSync(device2Page);

    // Wait for sync to propagate
    await device1Page.waitForTimeout(1000);

    // Device 1 syncs again to get latest
    await triggerSync(device1Page);
    await reloadAndWait(device1Page);

    // Device 2's entry should win (later timestamp)
    const content = await getCurrentEntryContent(device1Page);
    expect(content).toContain("OFFLINE-D2");
  });

  /**
   * Scenario 5: Multiple Rapid Edits
   */
  test("rapid-edits: eventual consistency after multiple edits", async () => {
    // Both devices login
    await devLogin(device1Page, testUserId);
    await devLogin(device2Page, testUserId);

    // Initial entry
    await createEntry(device1Page, `RAPID-INITIAL-${Date.now()}`);
    await triggerSync(device1Page);
    await triggerSync(device2Page);
    await reloadAndWait(device2Page);

    // Rapid edits alternating between devices
    for (let i = 0; i < 3; i++) {
      await createEntry(device1Page, `RAPID-D1-EDIT-${i}-${Date.now()}`);
      await triggerSync(device1Page);
      await device1Page.waitForTimeout(200);

      await createEntry(device2Page, `RAPID-D2-EDIT-${i}-${Date.now()}`);
      await triggerSync(device2Page);
      await device2Page.waitForTimeout(200);
    }

    // Final sync on both
    await triggerSync(device1Page);
    await triggerSync(device2Page);
    await device1Page.waitForTimeout(1000);
    await triggerSync(device1Page);
    await reloadAndWait(device1Page);
    await reloadAndWait(device2Page);

    // Both should have the same content (eventual consistency)
    const content1 = await getCurrentEntryContent(device1Page);
    const content2 = await getCurrentEntryContent(device2Page);

    // They should be equal (same last write)
    expect(content1).toBe(content2);
  });
});

test.describe("Multi-Device Sync - Edge Cases", () => {
  test.setTimeout(90000);

  /**
   * Edge case: Login on new device after data exists
   */
  test("new-device-login: new device gets all existing data", async ({ browser }) => {
    const testUserId = `new-device-user-${Date.now()}`;
    const entries = [
      `ENTRY-1-${Date.now()}`,
      `ENTRY-2-${Date.now()}`,
    ];

    // Device 1: Create multiple entries over "multiple days"
    const device1Context = await browser.newContext();
    const device1Page = await device1Context.newPage();

    await device1Page.goto("/");
    await clearIndexedDB(device1Page);
    await device1Page.reload();
    await device1Page.waitForTimeout(2000);

    await devLogin(device1Page, testUserId);

    // Create today's entry
    await createEntry(device1Page, entries[0]);
    await triggerSync(device1Page);

    // Navigate to yesterday and create entry
    await device1Page.goto("/");
    await device1Page.waitForTimeout(1000);
    const prevButton = device1Page.locator("button").filter({ has: device1Page.locator("svg.lucide-chevron-left") });
    await prevButton.click();
    await device1Page.waitForTimeout(500);

    const textarea = device1Page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 5000 });
    await textarea.fill(entries[1]);
    await device1Page.getByRole("button", { name: "Save" }).click();
    await device1Page.waitForTimeout(1000);
    await triggerSync(device1Page);

    // Device 2: New device logs in
    const device2Context = await browser.newContext();
    const device2Page = await device2Context.newPage();

    await device2Page.goto("/");
    await clearIndexedDB(device2Page);
    await device2Page.reload();
    await device2Page.waitForTimeout(2000);

    await devLogin(device2Page, testUserId);

    // Device 2 should see today's entry
    let content = await getCurrentEntryContent(device2Page);
    expect(content).toContain("ENTRY-1");

    // Navigate to yesterday - should see that entry too
    await device2Page.goto("/");
    await device2Page.waitForTimeout(1000);
    const prevButton2 = device2Page.locator("button").filter({ has: device2Page.locator("svg.lucide-chevron-left") });
    await prevButton2.click();
    await device2Page.waitForTimeout(1000);

    // Check if yesterday's entry is visible
    const paragraph = device2Page.locator("main p").first();
    if (await paragraph.isVisible({ timeout: 2000 }).catch(() => false)) {
      content = await paragraph.textContent();
      expect(content).toContain("ENTRY-2");
    }

    await device1Context.close();
    await device2Context.close();
  });
});
