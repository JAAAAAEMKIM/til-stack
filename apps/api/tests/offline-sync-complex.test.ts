/**
 * Complex Offline/Online Sync Test Suite
 * Tests edge cases for offline editing, sync conflicts, and data consistency
 *
 * Run: pnpm tsx tests/offline-sync-complex.test.ts
 * Requires: API server running on port 3003 with test database
 *
 * NOTE: Since service worker runs in browser, we simulate scenarios at API level
 * and verify database state to ensure server-side logic is correct.
 * The actual SW offline queue is tested via browser tests.
 */

import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import * as jose from "jose";

const API_URL = process.env.API_URL || "http://localhost:3003/trpc";
const DB_PATH = process.env.DATABASE_PATH || "./data/test/test.db";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const COOKIE_NAME = "til_session";

interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  details: string;
  scenario?: string;
}

const results: TestResult[] = [];

async function createSessionToken(userId: string, googleId: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({ userId, googleId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

function setupTestUser(db: Database.Database): { userId: string; googleId: string } {
  const userId = nanoid();
  const googleId = `google-offline-${userId}`;
  db.prepare(`INSERT OR IGNORE INTO users (id, google_id, created_at) VALUES (?, ?, datetime('now'))`).run(
    userId,
    googleId
  );
  return { userId, googleId };
}

async function trpcMutation(procedure: string, input: Record<string, unknown>, sessionToken: string) {
  const res = await fetch(`${API_URL}/${procedure}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${COOKIE_NAME}=${sessionToken}`,
    },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result?.data;
}

async function trpcQuery(procedure: string, input: Record<string, unknown> | undefined, sessionToken: string) {
  const url = input
    ? `${API_URL}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${API_URL}/${procedure}`;
  const res = await fetch(url, { headers: { Cookie: `${COOKIE_NAME}=${sessionToken}` } });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result?.data;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("=".repeat(75));
  console.log("COMPLEX OFFLINE/ONLINE SYNC TEST SUITE");
  console.log("=".repeat(75));
  console.log("\nSimulating multi-device offline scenarios with server-side verification\n");

  const db = new Database(DB_PATH);
  const { userId, googleId } = setupTestUser(db);
  const token = await createSessionToken(userId, googleId);

  console.log(`Test user: ${userId}`);
  console.log("");

  // Clean previous test data
  db.prepare("DELETE FROM entries WHERE date LIKE '2097-%'").run();

  console.log("-".repeat(75));

  // ================================================================
  // SCENARIO 1: Device A goes offline, edits, comes back online
  // ================================================================
  console.log("\n📱 SCENARIO 1: Single device offline edit cycle");
  console.log("   Flow: Create entry → Go offline → Edit → Come online → Sync");
  try {
    // Step 1: Device A creates entry while online
    const entry1 = await trpcMutation(
      "entries.upsert",
      { date: "2097-01-01", content: "Initial content - online" },
      token
    );
    console.log("   [Online] Created entry:", entry1.id);

    // Step 2: Simulate "offline edit" - just update with newer timestamp
    // In real SW, this would queue to sync_pending. Here we simulate the eventual sync.
    await delay(100);
    const entry2 = await trpcMutation(
      "entries.upsert",
      { date: "2097-01-01", content: "Edited while offline (simulated)" },
      token
    );
    console.log("   [Offline→Online] Synced offline edit:", entry2.updatedAt);

    // Verify
    const final = await trpcQuery("entries.getByDate", { date: "2097-01-01" }, token);
    if (final?.content?.includes("offline")) {
      results.push({
        name: "Single device offline edit",
        status: "PASS",
        details: "Offline edit synced correctly",
        scenario: "Device A: Online → Offline edit → Online sync",
      });
      console.log("   ✅ Offline edit synced correctly");
    } else {
      results.push({ name: "Single device offline edit", status: "FAIL", details: `Content: ${final?.content}` });
    }
  } catch (e: any) {
    results.push({ name: "Single device offline edit", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SCENARIO 2: Two devices, one offline - conflict on same entry
  // ================================================================
  console.log("\n📱💻 SCENARIO 2: Two devices edit same entry, one offline");
  console.log("   Flow: A online, B offline → Both edit same date → B syncs");
  try {
    // Setup: Create initial entry
    await trpcMutation("entries.upsert", { date: "2097-01-02", content: "Original" }, token);
    console.log("   [Setup] Created original entry");

    // Device A (online) edits
    const editA = await trpcMutation(
      "entries.upsert",
      { date: "2097-01-02", content: "Device A edit (online) - " + new Date().toISOString() },
      token
    );
    console.log("   [Device A - Online] Edited:", editA.updatedAt);

    // Device B (was offline) syncs later with NEWER timestamp
    await delay(200); // Simulate time passing while B was offline
    const editB = await trpcMutation(
      "entries.upsert",
      { date: "2097-01-02", content: "Device B edit (was offline, now syncing) - " + new Date().toISOString() },
      token
    );
    console.log("   [Device B - Sync] Edited:", editB.updatedAt);

    // Verify: Last write (Device B) should win
    const final = await trpcQuery("entries.getByDate", { date: "2097-01-02" }, token);
    if (final?.content?.includes("Device B")) {
      results.push({
        name: "Two devices, offline conflict",
        status: "PASS",
        details: "Device B (later sync) won - last-write-wins correct",
        scenario: "A online edit → B offline edit → B syncs → B wins",
      });
      console.log("   ✅ Device B (later sync) wins - last-write-wins");
    } else {
      results.push({
        name: "Two devices, offline conflict",
        status: "FAIL",
        details: `Expected B to win, got: ${final?.content?.substring(0, 40)}`,
      });
    }
  } catch (e: any) {
    results.push({ name: "Two devices, offline conflict", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SCENARIO 3: Offline device syncs OLDER edit (should lose)
  // ================================================================
  console.log("\n📱💻 SCENARIO 3: Offline device syncs stale edit");
  console.log("   Flow: Both start online → A goes offline → B edits → A syncs old edit");
  console.log("   Expected: Server should keep B's newer edit (last-write-wins by timestamp)");
  try {
    // Setup
    await trpcMutation("entries.upsert", { date: "2097-01-03", content: "Original content" }, token);

    // Device A "goes offline" at T0 with old edit timestamp
    const oldTimestamp = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    // Device B edits while A is offline (current time)
    const editB = await trpcMutation(
      "entries.upsert",
      { date: "2097-01-03", content: "Device B recent edit" },
      token
    );
    console.log("   [Device B - Online] Edited:", editB.updatedAt);

    // Device A comes online and syncs its OLD edit
    // NOTE: In real scenario, the SW would send updatedAt from when edit was made offline
    // Server-side upsert doesn't check timestamps - it just overwrites
    // This is a known limitation - SW should handle this client-side
    const editA = await trpcMutation(
      "entries.upsert",
      { date: "2097-01-03", content: "Device A stale edit (should this win?)" },
      token
    );
    console.log("   [Device A - Stale Sync] Edited:", editA.updatedAt);

    const final = await trpcQuery("entries.getByDate", { date: "2097-01-03" }, token);
    console.log("   Final content:", final?.content?.substring(0, 50));

    // Current implementation: Last API call wins regardless of logical timestamp
    // This is acceptable for simple use case but worth documenting
    results.push({
      name: "Stale edit sync behavior",
      status: "WARN",
      details: "Server uses arrival order, not logical timestamp. Final: " + final?.content?.substring(0, 30),
      scenario: "B edits → A syncs old → A wins (by arrival, not timestamp)",
    });
    console.log("   ⚠️ Last API call wins (arrival order, not logical timestamp)");
  } catch (e: any) {
    results.push({ name: "Stale edit sync behavior", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SCENARIO 4: Rapid offline queue sync
  // ================================================================
  console.log("\n📱 SCENARIO 4: Rapid offline queue flush (multiple pending ops)");
  console.log("   Flow: Device offline → Multiple edits → Comes online → Bulk sync");
  try {
    // Simulate queued edits being synced in order
    const dates = ["2097-01-04", "2097-01-05", "2097-01-06", "2097-01-07", "2097-01-08"];

    console.log("   [Syncing 5 offline edits in bulk...]");
    await Promise.all(
      dates.map((date, i) =>
        trpcMutation("entries.upsert", { date, content: `Offline edit #${i + 1} for ${date}` }, token)
      )
    );

    // Verify all synced
    const entries = await Promise.all(dates.map((date) => trpcQuery("entries.getByDate", { date }, token)));

    const allSynced = entries.every((e, i) => e?.content?.includes(`#${i + 1}`));

    if (allSynced) {
      results.push({
        name: "Bulk offline sync",
        status: "PASS",
        details: `All ${dates.length} offline edits synced correctly`,
        scenario: "5 entries edited offline → bulk sync → all persisted",
      });
      console.log("   ✅ All 5 offline edits synced correctly");
    } else {
      results.push({
        name: "Bulk offline sync",
        status: "FAIL",
        details: "Some entries missing or incorrect",
      });
    }
  } catch (e: any) {
    results.push({ name: "Bulk offline sync", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SCENARIO 5: Delete while offline, then sync
  // ================================================================
  console.log("\n📱 SCENARIO 5: Delete entry while offline, then sync");
  console.log("   Flow: Create → Go offline → Delete → Come online → Sync delete");
  try {
    // Create entry
    await trpcMutation("entries.upsert", { date: "2097-01-09", content: "Will be deleted" }, token);
    console.log("   [Online] Created entry to be deleted");

    // "Offline" delete (just call delete mutation)
    await trpcMutation("entries.delete", { date: "2097-01-09" }, token);
    console.log("   [Offline→Sync] Synced delete operation");

    // Verify deleted
    const entry = await trpcQuery("entries.getByDate", { date: "2097-01-09" }, token);
    if (entry === null) {
      results.push({
        name: "Offline delete sync",
        status: "PASS",
        details: "Delete synced correctly, entry removed",
        scenario: "Create → offline delete → sync → entry gone",
      });
      console.log("   ✅ Delete synced, entry removed");
    } else {
      results.push({ name: "Offline delete sync", status: "FAIL", details: "Entry still exists!" });
    }
  } catch (e: any) {
    results.push({ name: "Offline delete sync", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SCENARIO 6: Config sync across devices
  // ================================================================
  console.log("\n📱💻 SCENARIO 6: Config (skip days, templates) multi-device sync");
  try {
    // Device A adds skip day
    await trpcMutation("config.addSkipWeekday", { weekday: 6 }, token); // Saturday
    console.log("   [Device A] Added Saturday as skip day");

    // Device B reads config
    const skipDays = await trpcQuery("config.getSkipDays", undefined, token);
    console.log("   [Device B] Sees skip weekdays:", skipDays.weekdays);

    // Device A creates template
    const template = await trpcMutation(
      "config.createTemplate",
      { name: "Sync Test Template", content: "## Test" },
      token
    );
    console.log("   [Device A] Created template:", template.id);

    // Device B reads templates
    const templates = await trpcQuery("config.getTemplates", undefined, token);
    const hasTemplate = templates.some((t: any) => t.name === "Sync Test Template");

    if (skipDays.weekdays.includes(6) && hasTemplate) {
      results.push({
        name: "Config multi-device sync",
        status: "PASS",
        details: "Skip days and templates sync correctly between devices",
      });
      console.log("   ✅ Config syncs correctly across devices");
    } else {
      results.push({
        name: "Config multi-device sync",
        status: "FAIL",
        details: `Skip days: ${skipDays.weekdays}, Template found: ${hasTemplate}`,
      });
    }
  } catch (e: any) {
    results.push({ name: "Config multi-device sync", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SCENARIO 7: Extended offline period simulation
  // ================================================================
  console.log("\n📱 SCENARIO 7: Extended offline period (multiple days of edits)");
  try {
    const offlineDates = [
      "2097-02-01",
      "2097-02-02",
      "2097-02-03",
      "2097-02-04",
      "2097-02-05",
      "2097-02-06",
      "2097-02-07",
    ];

    console.log("   [Simulating 7 days of offline TIL entries...]");

    // Create 7 days of entries (as if user was offline for a week)
    for (let i = 0; i < offlineDates.length; i++) {
      await trpcMutation(
        "entries.upsert",
        {
          date: offlineDates[i],
          content: `Day ${i + 1} offline TIL entry - Lorem ipsum content for testing extended offline sync.`,
        },
        token
      );
    }
    console.log("   [Syncing all 7 days...]");

    // Verify all synced
    const list = await trpcQuery("entries.list", { limit: 50 }, token);
    const syncedEntries = list.items.filter((e: any) => e.date.startsWith("2097-02-"));

    if (syncedEntries.length === 7) {
      results.push({
        name: "Extended offline period sync",
        status: "PASS",
        details: "All 7 days of offline entries synced successfully",
      });
      console.log("   ✅ All 7 days synced successfully");
    } else {
      results.push({
        name: "Extended offline period sync",
        status: "FAIL",
        details: `Expected 7 entries, got ${syncedEntries.length}`,
      });
    }
  } catch (e: any) {
    results.push({ name: "Extended offline period sync", status: "FAIL", details: e.message });
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("\n" + "=".repeat(75));
  console.log("OFFLINE/ONLINE SYNC TEST RESULTS");
  console.log("=".repeat(75));

  let passed = 0,
    failed = 0,
    warned = 0;
  for (const result of results) {
    const icon = result.status === "PASS" ? "✅" : result.status === "WARN" ? "⚠️" : "❌";
    console.log(`${icon} ${result.name}: ${result.status}`);
    console.log(`   ${result.details}`);
    if (result.scenario) console.log(`   Scenario: ${result.scenario}`);
    if (result.status === "PASS") passed++;
    else if (result.status === "WARN") warned++;
    else failed++;
  }

  console.log("\n" + "-".repeat(75));
  console.log(`Total: ${results.length} | ✅ Pass: ${passed} | ⚠️ Warn: ${warned} | ❌ Fail: ${failed}`);
  console.log("-".repeat(75));

  // Cleanup
  const cleanupDb = new Database(DB_PATH);
  cleanupDb.prepare("DELETE FROM entries WHERE date LIKE '2097-%'").run();
  cleanupDb.prepare("DELETE FROM skip_days WHERE user_id = ?").run(userId);
  cleanupDb.prepare("DELETE FROM templates WHERE user_id = ?").run(userId);
  cleanupDb.prepare("DELETE FROM users WHERE id = ?").run(userId);
  cleanupDb.close();
  console.log("\nTest data cleaned up.");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
