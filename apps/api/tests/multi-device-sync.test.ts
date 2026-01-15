/**
 * Multi-Device Same-User Test Suite
 * Tests scenarios where the SAME user is using multiple devices
 * with various online/offline combinations
 *
 * Run: pnpm tsx tests/multi-device-sync.test.ts
 * Requires: API server running on port 3003 with test database
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
}

const results: TestResult[] = [];

// Create real JWT token for testing
async function createSessionToken(userId: string, googleId: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({ userId, googleId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

// Create test user in DB
function setupTestUser(db: Database.Database): { userId: string; googleId: string } {
  const userId = nanoid();
  const googleId = `google-multidevice-${userId}`;

  db.prepare(`
    INSERT OR IGNORE INTO users (id, google_id, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(userId, googleId);

  return { userId, googleId };
}

async function trpcMutation(
  procedure: string,
  input: Record<string, unknown>,
  sessionToken: string
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: `${COOKIE_NAME}=${sessionToken}`,
  };

  const res = await fetch(`${API_URL}/${procedure}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.result?.data;
}

async function trpcQuery(
  procedure: string,
  input: Record<string, unknown> | undefined,
  sessionToken: string
) {
  const headers: Record<string, string> = {
    Cookie: `${COOKIE_NAME}=${sessionToken}`,
  };

  const url = input
    ? `${API_URL}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${API_URL}/${procedure}`;

  const res = await fetch(url, { headers });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.result?.data;
}

// Simulate delay (network latency)
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("=".repeat(70));
  console.log("MULTI-DEVICE SAME-USER TEST SUITE");
  console.log("=".repeat(70));
  console.log("\nSimulating ONE user on MULTIPLE devices with sync scenarios\n");

  // Setup
  const db = new Database(DB_PATH);
  const { userId, googleId } = setupTestUser(db);
  const token = await createSessionToken(userId, googleId);

  console.log(`Created test user: ${userId}`);
  console.log(`Using same session token for all "devices"\n`);

  // Clean up any test data from previous runs
  db.prepare("DELETE FROM entries WHERE date LIKE '2098-%'").run();
  db.close();

  console.log("-".repeat(70));

  // ================================================================
  // TEST 1: Same user, two devices, sequential edits (no conflict)
  // ================================================================
  console.log("\n[TEST 1] Same user, Device A writes, then Device B reads");
  console.log("  Scenario: User starts on laptop, then checks phone");
  try {
    // Device A creates entry
    const entryA = await trpcMutation(
      "entries.upsert",
      { date: "2098-01-01", content: "Written from laptop - Device A" },
      token
    );
    console.log(`  Device A: Created entry ${entryA.id}`);

    // Small delay to simulate switching devices
    await delay(100);

    // Device B reads the same entry
    const entryB = await trpcQuery("entries.getByDate", { date: "2098-01-01" }, token);
    console.log(`  Device B: Read entry content = "${entryB?.content?.substring(0, 30)}..."`);

    if (entryB?.content === "Written from laptop - Device A") {
      results.push({
        name: "Multi-device read consistency",
        status: "PASS",
        details: "Device B correctly sees Device A's data",
      });
      console.log("  ✓ Device B sees Device A's content");
    } else {
      results.push({
        name: "Multi-device read consistency",
        status: "FAIL",
        details: `Expected Device A's content, got: ${entryB?.content}`,
      });
    }
  } catch (e: any) {
    results.push({
      name: "Multi-device read consistency",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 2: Same user, two devices, Device B overwrites Device A
  // ================================================================
  console.log("\n[TEST 2] Same user, Device B updates entry created by Device A");
  console.log("  Scenario: User edited on laptop, now updates on phone");
  try {
    // Device B updates the same entry
    const entryB = await trpcMutation(
      "entries.upsert",
      { date: "2098-01-01", content: "Updated from phone - Device B" },
      token
    );
    console.log(`  Device B: Updated entry ${entryB.id}`);

    // Device A reads again
    const entryA = await trpcQuery("entries.getByDate", { date: "2098-01-01" }, token);
    console.log(`  Device A: Read entry content = "${entryA?.content?.substring(0, 30)}..."`);

    if (entryA?.content === "Updated from phone - Device B") {
      results.push({
        name: "Multi-device write consistency",
        status: "PASS",
        details: "Device A sees Device B's update",
      });
      console.log("  ✓ Device A sees Device B's update");
    } else {
      results.push({
        name: "Multi-device write consistency",
        status: "FAIL",
        details: `Expected Device B's content, got: ${entryA?.content}`,
      });
    }
  } catch (e: any) {
    results.push({
      name: "Multi-device write consistency",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 3: Concurrent edits - last write wins
  // ================================================================
  console.log("\n[TEST 3] Concurrent edits - simulated race condition");
  console.log("  Scenario: Both devices edit the same entry nearly simultaneously");
  try {
    // Create fresh entry
    await trpcMutation(
      "entries.upsert",
      { date: "2098-01-02", content: "Original content" },
      token
    );

    // Simulate concurrent writes (in practice, one will win)
    const [resultA, resultB] = await Promise.all([
      trpcMutation(
        "entries.upsert",
        { date: "2098-01-02", content: "Device A concurrent edit at " + Date.now() },
        token
      ),
      (async () => {
        await delay(50); // Slight delay so B is later
        return trpcMutation(
          "entries.upsert",
          { date: "2098-01-02", content: "Device B concurrent edit at " + Date.now() },
          token
        );
      })(),
    ]);

    console.log(`  Device A wrote: ${resultA.updatedAt}`);
    console.log(`  Device B wrote: ${resultB.updatedAt}`);

    // Read final state
    const finalEntry = await trpcQuery("entries.getByDate", { date: "2098-01-02" }, token);
    console.log(`  Final content: "${finalEntry?.content?.substring(0, 40)}..."`);

    // The later write should win
    if (finalEntry?.content?.includes("Device B")) {
      results.push({
        name: "Concurrent edit - last write wins",
        status: "PASS",
        details: "Device B (later write) won as expected",
      });
      console.log("  ✓ Device B (later write) content persisted");
    } else if (finalEntry?.content?.includes("Device A")) {
      results.push({
        name: "Concurrent edit - last write wins",
        status: "WARN",
        details: "Device A won - timing variance, still consistent",
      });
      console.log("  ⚠ Device A won (timing variance, but still consistent)");
    } else {
      results.push({
        name: "Concurrent edit - last write wins",
        status: "FAIL",
        details: `Unexpected content: ${finalEntry?.content}`,
      });
    }
  } catch (e: any) {
    results.push({
      name: "Concurrent edit - last write wins",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 4: Rapid sequential updates from same device
  // ================================================================
  console.log("\n[TEST 4] Rapid sequential updates (debouncing simulation)");
  console.log("  Scenario: User typing fast, multiple saves in quick succession");
  try {
    // Rapid fire updates
    for (let i = 1; i <= 5; i++) {
      await trpcMutation(
        "entries.upsert",
        { date: "2098-01-03", content: `Rapid update #${i}` },
        token
      );
    }
    console.log("  Sent 5 rapid updates");

    // Check final state
    const finalEntry = await trpcQuery("entries.getByDate", { date: "2098-01-03" }, token);
    console.log(`  Final content: "${finalEntry?.content}"`);

    if (finalEntry?.content === "Rapid update #5") {
      results.push({
        name: "Rapid sequential updates",
        status: "PASS",
        details: "Final update (#5) is persisted correctly",
      });
      console.log("  ✓ Final update (#5) persisted");
    } else {
      results.push({
        name: "Rapid sequential updates",
        status: "FAIL",
        details: `Expected 'Rapid update #5', got: ${finalEntry?.content}`,
      });
    }
  } catch (e: any) {
    results.push({
      name: "Rapid sequential updates",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 5: Multiple devices, multiple dates
  // ================================================================
  console.log("\n[TEST 5] Multiple devices, multiple different dates");
  console.log("  Scenario: User writes different days from different devices");
  try {
    // Device A creates entries for Mon, Tue
    await trpcMutation("entries.upsert", { date: "2098-01-04", content: "Monday from laptop" }, token);
    await trpcMutation("entries.upsert", { date: "2098-01-05", content: "Tuesday from laptop" }, token);

    // Device B creates entries for Wed, Thu
    await trpcMutation("entries.upsert", { date: "2098-01-06", content: "Wednesday from phone" }, token);
    await trpcMutation("entries.upsert", { date: "2098-01-07", content: "Thursday from phone" }, token);

    // List all entries from any device
    const list = await trpcQuery("entries.list", { limit: 50 }, token);
    const testEntries = list.items.filter((e: any) => e.date.startsWith("2098-01-0"));

    console.log(`  Created 4 entries across 2 "devices"`);
    console.log(`  List shows ${testEntries.length} entries from user`);

    if (testEntries.length >= 4) {
      results.push({
        name: "Multi-device multi-date consistency",
        status: "PASS",
        details: `All ${testEntries.length} entries visible from any device`,
      });
      console.log("  ✓ All entries visible from any device");
    } else {
      results.push({
        name: "Multi-device multi-date consistency",
        status: "FAIL",
        details: `Expected at least 4 entries, got ${testEntries.length}`,
      });
    }
  } catch (e: any) {
    results.push({
      name: "Multi-device multi-date consistency",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 6: Verify DB state directly
  // ================================================================
  console.log("\n[TEST 6] Direct DB verification for this user");
  try {
    const dbCheck = new Database(DB_PATH);
    const entries = dbCheck
      .prepare("SELECT date, content, user_id FROM entries WHERE user_id = ? AND date LIKE '2098-%'")
      .all(userId) as Array<{ date: string; content: string; user_id: string }>;

    console.log(`  DB has ${entries.length} entries for this user:`);
    for (const e of entries.slice(0, 5)) {
      console.log(`    - ${e.date}: "${e.content.substring(0, 30)}..."`);
    }

    // All entries should have the same user_id
    const allSameUser = entries.every((e) => e.user_id === userId);

    if (allSameUser && entries.length >= 5) {
      results.push({
        name: "DB state verification",
        status: "PASS",
        details: `All ${entries.length} entries correctly associated with user ${userId}`,
      });
      console.log("  ✓ All entries have correct user_id");
    } else {
      results.push({
        name: "DB state verification",
        status: "FAIL",
        details: `user_id mismatch or missing entries`,
      });
    }

    dbCheck.close();
  } catch (e: any) {
    results.push({
      name: "DB state verification",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 7: Delete from one device, verify on another
  // ================================================================
  console.log("\n[TEST 7] Delete from Device A, verify absence on Device B");
  try {
    // Device A deletes an entry
    await trpcMutation("entries.delete", { date: "2098-01-04" }, token);
    console.log("  Device A: Deleted entry for 2098-01-04");

    // Device B tries to read it
    const entry = await trpcQuery("entries.getByDate", { date: "2098-01-04" }, token);
    console.log(`  Device B: Entry for 2098-01-04 = ${entry}`);

    if (entry === null) {
      results.push({
        name: "Multi-device delete consistency",
        status: "PASS",
        details: "Device B correctly sees entry as deleted",
      });
      console.log("  ✓ Device B correctly sees entry as deleted");
    } else {
      results.push({
        name: "Multi-device delete consistency",
        status: "FAIL",
        details: `Entry still exists: ${entry.content}`,
      });
    }
  } catch (e: any) {
    results.push({
      name: "Multi-device delete consistency",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("\n" + "=".repeat(70));
  console.log("MULTI-DEVICE TEST RESULTS");
  console.log("=".repeat(70));

  let passed = 0,
    failed = 0,
    warned = 0;
  for (const result of results) {
    const icon =
      result.status === "PASS" ? "✅" : result.status === "WARN" ? "⚠️" : "❌";
    console.log(`${icon} ${result.name}: ${result.status}`);
    console.log(`   ${result.details}`);
    if (result.status === "PASS") passed++;
    else if (result.status === "WARN") warned++;
    else failed++;
  }

  console.log("\n" + "-".repeat(70));
  console.log(`Total: ${results.length} | ✅ Pass: ${passed} | ⚠️ Warn: ${warned} | ❌ Fail: ${failed}`);
  console.log("-".repeat(70));

  // Cleanup
  const cleanupDb = new Database(DB_PATH);
  cleanupDb.prepare("DELETE FROM entries WHERE date LIKE '2098-%'").run();
  cleanupDb.prepare("DELETE FROM users WHERE id = ?").run(userId);
  cleanupDb.close();
  console.log("\nTest data cleaned up.");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Test suite failed:", e);
  process.exit(1);
});
