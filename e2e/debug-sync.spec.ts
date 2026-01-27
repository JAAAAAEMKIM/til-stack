import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";

const DB_NAME = "til-stack-local";

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

test.describe("Debug Sync Flow", () => {
  test.setTimeout(120000);

  test("debug: trace sync flow between two devices", async ({ browser }) => {
    const testUserId = "debug-user-" + Date.now();
    const entryContent = "DEBUG-ENTRY-" + Date.now() + ": Test content";

    // Create two browser contexts
    const device1Context = await browser.newContext();
    const device2Context = await browser.newContext();

    const device1Page = await device1Context.newPage();
    const device2Page = await device2Context.newPage();

    // Collect console logs
    const device1Logs: string[] = [];
    const device2Logs: string[] = [];

    device1Page.on("console", msg => {
      const text = msg.text();
      if (text.includes("[SW]") || text.includes("[DevLogin]") || text.includes("[Auth]") || text.includes("[Persistence]")) {
        device1Logs.push("D1: " + text);
      }
    });

    device2Page.on("console", msg => {
      const text = msg.text();
      if (text.includes("[SW]") || text.includes("[DevLogin]") || text.includes("[Auth]") || text.includes("[Persistence]")) {
        device2Logs.push("D2: " + text);
      }
    });

    // Clear IndexedDB for both
    await device1Page.goto("http://localhost:3000/");
    await clearIndexedDB(device1Page);
    await device1Page.reload();
    await device1Page.waitForTimeout(2000);

    await device2Page.goto("http://localhost:3000/");
    await clearIndexedDB(device2Page);
    await device2Page.reload();
    await device2Page.waitForTimeout(2000);

    console.log("=== STEP 1: Device 1 Login ===");

    // Device 1 login
    await device1Page.goto("/login");
    await device1Page.waitForTimeout(500);
    await device1Page.getByRole("textbox", { name: "Test Google ID" }).fill(testUserId);
    await device1Page.getByRole("button", { name: "Dev Login" }).click();
    await device1Page.waitForURL("/");
    await device1Page.waitForTimeout(2000);

    console.log("Device 1 login complete. Logs:");
    device1Logs.forEach(log => console.log(log));
    device1Logs.length = 0;

    console.log("\n=== STEP 2: Device 1 Creates Entry ===");

    // Device 1 creates entry
    const textarea = device1Page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.fill(entryContent);
    await device1Page.getByRole("button", { name: "Save" }).click();
    await device1Page.waitForTimeout(1000);

    console.log("Device 1 entry created. Logs:");
    device1Logs.forEach(log => console.log(log));
    device1Logs.length = 0;

    console.log("\n=== STEP 3: Device 1 Triggers Sync ===");

    // Device 1 triggers sync via config page
    await device1Page.goto("/config");
    await device1Page.waitForTimeout(1000);
    const syncButton = device1Page.locator("button[title='Sync now']");
    if (await syncButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Clicking sync button...");
      await syncButton.click();
      await device1Page.waitForTimeout(3000);
    } else {
      console.log("Sync button NOT visible!");
    }

    console.log("Device 1 sync triggered. Logs:");
    device1Logs.forEach(log => console.log(log));
    device1Logs.length = 0;

    // Wait for sync to complete on server
    await device1Page.waitForTimeout(2000);

    console.log("\n=== STEP 4: Check Server Has Entry ===");

    // Verify entry is on server by checking API directly from Device 1's context
    const apiCheck = await device1Page.evaluate(async () => {
      const response = await fetch("/trpc/entries.list?input=" + encodeURIComponent(JSON.stringify({ limit: 10 })), {
        credentials: "include"
      });
      return response.json();
    });
    console.log("Server entries (from Device 1):", JSON.stringify(apiCheck, null, 2));

    console.log("\n=== STEP 5: Device 2 Login (Same User) ===");

    // Device 2 login as same user
    await device2Page.goto("/login");
    await device2Page.waitForTimeout(500);
    await device2Page.getByRole("textbox", { name: "Test Google ID" }).fill(testUserId);
    await device2Page.getByRole("button", { name: "Dev Login" }).click();
    await device2Page.waitForURL("/");
    await device2Page.waitForTimeout(3000);  // Longer wait for sync

    console.log("Device 2 login complete. Logs:");
    device2Logs.forEach(log => console.log(log));
    device2Logs.length = 0;

    console.log("\n=== STEP 6: Check Device 2 Data ===");

    // Check what's in Device 2's local database
    const d2LocalData = await device2Page.evaluate(async () => {
      const registration = await navigator.serviceWorker?.ready;
      if (!registration?.active) return { error: "No SW" };

      return new Promise((resolve) => {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => resolve(event.data);
        registration.active?.postMessage({ type: "DEBUG_STATE" }, [messageChannel.port2]);
        setTimeout(() => resolve({ error: "timeout" }), 5000);
      });
    });
    console.log("Device 2 SW State:", JSON.stringify(d2LocalData, null, 2));

    // Check if Device 2 can see the entry via UI
    await device2Page.goto("/");
    await device2Page.waitForTimeout(2000);

    const pageContent = await device2Page.locator("main").textContent();
    console.log("Device 2 main content:", pageContent?.substring(0, 500));

    // Check if entry is visible
    const hasEntry = pageContent?.includes("DEBUG-ENTRY");
    console.log("\n=== RESULT ===");
    console.log("Entry visible on Device 2: " + hasEntry);

    if (!hasEntry) {
      // Additional debug: Check what's in Device 2's IndexedDB directly
      const idbContent = await device2Page.evaluate(async () => {
        return new Promise((resolve) => {
          const req = indexedDB.open("til-stack-local", 1);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("database", "readonly");
            const store = tx.objectStore("database");
            const getAllKeys = store.getAllKeys();
            getAllKeys.onsuccess = () => {
              resolve({ keys: getAllKeys.result });
            };
            getAllKeys.onerror = () => resolve({ error: "getAllKeys failed" });
          };
          req.onerror = () => resolve({ error: "open failed" });
        });
      });
      console.log("Device 2 IndexedDB keys:", JSON.stringify(idbContent));
    }

    await device1Context.close();
    await device2Context.close();

    // This test is for debugging - always pass
    expect(true).toBe(true);
  });
});
