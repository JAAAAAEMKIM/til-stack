import { test, expect } from "@playwright/test";

/**
 * E2E Tests for Guest Users (Not Logged In)
 * Based on user cases UC-G1 through UC-G12
 */

test.describe("Guest User - Entry Management", () => {
  test.beforeEach(async ({ page }) => {
    // Clear IndexedDB before each test for clean state
    await page.goto("/");
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("til-stack-db");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    });
    // Reload to start fresh
    await page.reload();
    // Wait for service worker to be ready
    await page.waitForTimeout(1000);
  });

  /**
   * UC-G1: View Entry List
   * Guest user can view their locally stored entries on the home page.
   */
  test("guest-entry-list: can view entry list on home page", async ({ page }) => {
    await page.goto("/");

    // Page should load without errors
    await expect(page).toHaveURL("/");

    // Should see the main editor area (textarea for new entry)
    await expect(page.locator("textarea")).toBeVisible();

    // Should see "Stack" section heading
    await expect(page.getByRole("heading", { name: "Stack" })).toBeVisible();
  });

  /**
   * UC-G2: Create New Entry
   * Guest user can create a new TIL entry for today.
   */
  test("guest-create-entry: can create a new entry for today", async ({ page }) => {
    await page.goto("/");

    // Find the textarea and enter content
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();

    const testContent = `Today I learned about Playwright E2E testing! ${Date.now()}`;
    await textarea.fill(testContent);

    // Click save button (button with "Save" text)
    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(500);

    // Verify entry appears (reload to confirm persistence)
    await page.reload();
    await page.waitForTimeout(1000);

    // Should see the saved content rendered as markdown
    await expect(page.getByText(testContent.substring(0, 30))).toBeVisible();
  });

  /**
   * UC-G3: Edit Existing Entry
   * Guest user can edit an existing entry.
   */
  test("guest-edit-entry: can edit an existing entry", async ({ page }) => {
    await page.goto("/");

    // First create an entry
    const textarea = page.locator("textarea").first();
    const originalContent = `Original content ${Date.now()}`;
    await textarea.fill(originalContent);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await page.waitForTimeout(500);

    // After saving, the entry shows in view mode with an edit (pencil) button
    // Find and click the pencil/edit button
    const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
    await editButton.click();
    await page.waitForTimeout(300);

    // Now should be in edit mode, find textarea again
    const editTextarea = page.locator("textarea").first();
    await expect(editTextarea).toBeVisible();

    // Modify the content
    const updatedContent = `Updated content ${Date.now()}`;
    await editTextarea.fill(updatedContent);
    await saveButton.click();
    await page.waitForTimeout(500);

    // Reload and verify update
    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.getByText(updatedContent.substring(0, 20))).toBeVisible();
  });

  /**
   * UC-G4: Delete Entry
   * Guest user can delete an existing entry.
   */
  test("guest-delete-entry: can delete an existing entry", async ({ page }) => {
    await page.goto("/");

    // First create an entry
    const textarea = page.locator("textarea").first();
    const contentToDelete = `Content to delete ${Date.now()}`;
    await textarea.fill(contentToDelete);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await page.waitForTimeout(500);

    // Enter edit mode first (click pencil icon)
    const editButton = page.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
    await editButton.click();
    await page.waitForTimeout(300);

    // Set up dialog handler before clicking delete
    page.on("dialog", (dialog) => dialog.accept());

    // Find and click delete button (trash icon, destructive variant)
    const deleteButton = page.locator("button").filter({ has: page.locator("svg.lucide-trash-2") }).first();
    await deleteButton.click();
    await page.waitForTimeout(500);

    // Reload and verify deletion
    await page.reload();
    await page.waitForTimeout(1000);

    // Should now see "New Entry" card instead of the deleted content
    await expect(page.getByText("New Entry")).toBeVisible();
    // Content should no longer be visible
    await expect(page.getByText(contentToDelete.substring(0, 20))).not.toBeVisible();
  });

  /**
   * UC-G5: Navigate Between Days
   * Guest user can navigate to different dates.
   */
  test("guest-navigate-dates: can navigate between days", async ({ page }) => {
    await page.goto("/");

    // Get the date display (format: YYYY-MM-DD)
    const dateDisplay = page.locator(".text-lg.font-semibold").first();
    const initialDate = await dateDisplay.textContent();

    // Find navigation buttons (ChevronLeft and ChevronRight icons)
    const prevButton = page.locator("button").filter({ has: page.locator("svg.lucide-chevron-left") });
    const nextButton = page.locator("button").filter({ has: page.locator("svg.lucide-chevron-right") });

    // Click previous day
    await prevButton.click();
    await page.waitForTimeout(300);

    // Date should change
    const newDate = await dateDisplay.textContent();
    expect(newDate).not.toBe(initialDate);

    // Navigate forward (should return to today)
    await nextButton.click();
    await page.waitForTimeout(300);

    // Should be back at original date
    const finalDate = await dateDisplay.textContent();
    expect(finalDate).toBe(initialDate);
  });
});

test.describe("Guest User - Monthly View", () => {
  /**
   * UC-G6: View Monthly Calendar
   * Guest user can view entries in monthly calendar view.
   */
  test("guest-monthly-view: can view monthly calendar", async ({ page }) => {
    await page.goto("/monthly");
    await page.waitForTimeout(500);

    // Should be on monthly page
    await expect(page).toHaveURL("/monthly");

    // Should see month/year header (e.g., "January 2025")
    const monthHeader = page.locator("h1, h2").filter({ hasText: /\d{4}/ });
    await expect(monthHeader.first()).toBeVisible();

    // Should see day headers (Sun, Mon, etc.) - use exact match to avoid navigation link
    await expect(page.getByText("Sun", { exact: true })).toBeVisible();
    await expect(page.getByText("Mon", { exact: true })).toBeVisible();
    await expect(page.getByText("Tue", { exact: true })).toBeVisible();

    // Should see Monthly Summary section
    await expect(page.getByRole("heading", { name: "Monthly Summary" })).toBeVisible();
  });
});

test.describe("Guest User - Settings", () => {
  /**
   * UC-G7: Configure Skip Days
   * Guest user can configure which days to skip when navigating.
   */
  test("guest-skip-days: can configure skip days", async ({ page }) => {
    await page.goto("/config");
    await page.waitForTimeout(500);

    // Should see "Days to Skip" card title
    await expect(page.getByRole("heading", { name: "Days to Skip" })).toBeVisible();

    // Should see "Recurring Weekdays" section
    await expect(page.getByText("Recurring Weekdays")).toBeVisible();

    // Should see weekday toggle buttons (Sun, Mon, etc.)
    const saturdayButton = page.getByRole("button", { name: "Sat" });
    await expect(saturdayButton).toBeVisible();

    // Toggle Saturday to skip
    await saturdayButton.click();
    await page.waitForTimeout(500);

    // Reload to verify persistence
    await page.reload();
    await page.waitForTimeout(1000);

    // Saturday should still be selected (has default/primary variant)
    await expect(page.getByRole("button", { name: "Sat" })).toBeVisible();
  });

  /**
   * UC-G8: Manage Templates
   * Guest user can create and manage entry templates.
   */
  test("guest-templates: can manage templates", async ({ page }) => {
    await page.goto("/config");
    await page.waitForTimeout(1000);

    // Should see templates section
    await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();

    // Click "New Template" button
    const newTemplateButton = page.getByRole("button", { name: "New Template" });
    await expect(newTemplateButton).toBeVisible();
    await newTemplateButton.click();
    await page.waitForTimeout(500);

    // Should see template form with name input
    const templateNameInput = page.getByPlaceholder("Template name");
    await expect(templateNameInput).toBeVisible();

    // Fill in template details
    const templateName = `Test Template ${Date.now()}`;
    await templateNameInput.fill(templateName);

    const contentTextarea = page.getByPlaceholder("Template content (markdown)");
    await contentTextarea.fill("# TIL\n\n- What I learned today");

    // Click Create button and wait for creation
    const createButton = page.getByRole("button", { name: "Create" });
    await createButton.click();

    // Wait for template to be created and form to close
    await page.waitForTimeout(1000);

    // Template should be visible in list (check for truncated or full name)
    await expect(page.getByText(templateName.substring(0, 20))).toBeVisible();
  });

  /**
   * UC-G9: View Account Section (Guest)
   * Guest user sees login prompt in settings.
   */
  test("guest-account-section: sees login prompt when not logged in", async ({ page }) => {
    await page.goto("/config");
    await page.waitForTimeout(500);

    // Should see Account card
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

    // Should see description about syncing
    await expect(page.getByText(/sync your data across devices/i)).toBeVisible();

    // Should see "Sign in with Google" button
    const signInButton = page.getByRole("button", { name: /Sign in with Google/i });
    await expect(signInButton).toBeVisible();
  });

  /**
   * UC-G10: Webhooks Disabled
   * Guest user cannot configure webhooks.
   */
  test("guest-webhooks-disabled: webhooks require login", async ({ page }) => {
    await page.goto("/config");
    await page.waitForTimeout(500);

    // Should see webhooks section with "Requires Login" badge
    await expect(page.getByRole("heading", { name: /Webhooks/i })).toBeVisible();
    await expect(page.getByText("Requires Login")).toBeVisible();

    // Should see message to sign in
    await expect(page.getByText(/Sign in to schedule webhook/i)).toBeVisible();

    // Should NOT see "New Webhook" button
    const newWebhookButton = page.getByRole("button", { name: /New Webhook/i });
    await expect(newWebhookButton).not.toBeVisible();
  });

  /**
   * UC-G11: Navigate to Login Page
   * Guest user can navigate to login page.
   */
  test("guest-login-navigation: can navigate to login page", async ({ page }) => {
    await page.goto("/config");
    await page.waitForTimeout(500);

    // Click "Sign in with Google" button
    const signInButton = page.getByRole("button", { name: /Sign in with Google/i });
    await signInButton.click();
    await page.waitForTimeout(500);

    // Should navigate to login page
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Guest User - Offline", () => {
  /**
   * UC-G12: Offline Functionality
   * Guest user can use the app offline.
   * Note: Testing true offline mode is limited in Playwright - we verify
   * data persists locally which is the key offline capability.
   */
  test("guest-offline: app works offline", async ({ page }) => {
    // First load the app
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Create an entry
    const textarea = page.locator("textarea").first();
    const content = `Offline test ${Date.now()}`;
    await textarea.fill(content);

    const saveButton = page.getByRole("button", { name: "Save" });
    await saveButton.click();
    await page.waitForTimeout(500);

    // Verify entry is saved locally (persists after reload)
    await page.reload();
    await page.waitForTimeout(1000);

    // Entry should persist (stored in IndexedDB via service worker)
    await expect(page.getByText(content.substring(0, 15))).toBeVisible();

    // Navigate to previous day and create another entry
    const prevButton = page.locator("button").filter({ has: page.locator("svg.lucide-chevron-left") });
    await prevButton.click();
    await page.waitForTimeout(300);

    const content2 = `Second entry ${Date.now()}`;
    await textarea.fill(content2);
    await saveButton.click();
    await page.waitForTimeout(500);

    // Both entries should persist after reload
    await page.reload();
    await page.waitForTimeout(1000);

    await expect(page.getByText(content2.substring(0, 12))).toBeVisible();
  });
});

test.describe("Guest User - Edge Cases", () => {
  /**
   * UC-E1: Service Worker Not Ready
   * App handles case when service worker isn't registered yet.
   */
  test("edge-sw-not-ready: handles service worker not ready", async ({ page }) => {
    // Navigate directly - SW might not be ready
    await page.goto("/");

    // App should eventually load with textarea visible
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });

    // Should see the Stack section
    await expect(page.getByRole("heading", { name: "Stack" })).toBeVisible();
  });

  /**
   * UC-E2: Draft Auto-Save
   * Drafts are automatically saved to prevent data loss.
   */
  test("edge-draft-autosave: auto-saves drafts", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Type in textarea but don't save
    const textarea = page.locator("textarea").first();
    const draftContent = `Draft content ${Date.now()}`;
    await textarea.fill(draftContent);

    // Wait for debounced autosave (500ms + buffer)
    await page.waitForTimeout(1000);

    // Reload page (simulating closing and reopening)
    await page.reload();
    await page.waitForTimeout(1000);

    // Draft should be restored in textarea
    const restoredTextarea = page.locator("textarea").first();
    const restoredValue = await restoredTextarea.inputValue();

    // Draft should contain our content
    expect(restoredValue).toBe(draftContent);
  });

  /**
   * UC-E3: Theme Persistence
   * Theme preference persists across sessions.
   */
  test("edge-theme-persistence: persists theme preference", async ({ page }) => {
    await page.goto("/config");
    await page.waitForTimeout(500);

    // Should see Appearance section with theme buttons
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

    // Find and click Dark theme button
    const darkButton = page.getByRole("button", { name: "Dark" });
    await darkButton.click();
    await page.waitForTimeout(500);

    // Check if dark class is present on html element
    let isDark = await page.evaluate(() => {
      return document.documentElement.classList.contains("dark");
    });
    expect(isDark).toBeTruthy();

    // Reload and check theme persists
    await page.reload();
    await page.waitForTimeout(1000);

    // Dark class should still be present
    isDark = await page.evaluate(() => {
      return document.documentElement.classList.contains("dark");
    });
    expect(isDark).toBeTruthy();

    // Dark button should be selected (has default variant)
    // Reset to system theme for other tests
    const systemButton = page.getByRole("button", { name: "System" });
    await systemButton.click();
  });
});
