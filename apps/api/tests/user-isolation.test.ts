/**
 * Multi-User Isolation Test Script
 * Tests that different users (authenticated via session) cannot see each other's data
 * This is the CRITICAL security test for user data isolation
 *
 * Run: pnpm tsx tests/user-isolation.test.ts
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
  status: "PASS" | "FAIL" | "CRITICAL_FAIL";
  details: string;
}

const results: TestResult[] = [];

// Create real JWT token for testing (matching auth.ts structure)
async function createSessionToken(userId: string, googleId: string): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({ userId, googleId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

// Create test users in DB
function setupTestUsers(db: Database.Database): { userA: string; userB: string } {
  const userAId = nanoid();
  const userBId = nanoid();

  // Insert test users
  db.prepare(`
    INSERT OR IGNORE INTO users (id, google_id, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(userAId, `google-test-a-${userAId}`);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, google_id, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(userBId, `google-test-b-${userBId}`);

  return { userA: userAId, userB: userBId };
}

async function trpcMutation(
  procedure: string,
  input: Record<string, unknown>,
  sessionToken?: string
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["Cookie"] = `${COOKIE_NAME}=${sessionToken}`;
  }

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
  input?: Record<string, unknown>,
  sessionToken?: string
) {
  const headers: Record<string, string> = {};
  if (sessionToken) {
    headers["Cookie"] = `${COOKIE_NAME}=${sessionToken}`;
  }

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

async function runTests() {
  console.log("=".repeat(60));
  console.log("MULTI-USER ISOLATION TEST SUITE");
  console.log("=".repeat(60));
  console.log("\nThis test verifies that User A CANNOT see User B's data\n");

  // Setup test users
  const db = new Database(DB_PATH);
  const { userA, userB } = setupTestUsers(db);
  console.log(`Created test users:`);
  console.log(`  User A: ${userA}`);
  console.log(`  User B: ${userB}`);

  // Create session tokens (with correct googleId)
  const googleIdA = `google-test-a-${userA}`;
  const googleIdB = `google-test-b-${userB}`;
  const tokenA = await createSessionToken(userA, googleIdA);
  const tokenB = await createSessionToken(userB, googleIdB);

  // Clean up any test data from previous runs
  db.prepare("DELETE FROM entries WHERE date LIKE '2099-%'").run();
  db.prepare("DELETE FROM skip_days WHERE user_id IN (?, ?)").run(userA, userB);
  db.prepare("DELETE FROM templates WHERE user_id IN (?, ?)").run(userA, userB);
  db.close();

  console.log("\n" + "-".repeat(60));

  // ================================================================
  // TEST 1: User A creates entry, User B cannot see it
  // ================================================================
  console.log("\n[TEST 1] User A creates private entry...");
  try {
    // User A creates entry
    const entryA = await trpcMutation(
      "entries.upsert",
      { date: "2099-01-01", content: "User A's private entry - SECRET DATA" },
      tokenA
    );
    console.log(`  ✓ User A created entry: ${entryA.id}`);

    // User B tries to read it
    const entryB = await trpcQuery("entries.getByDate", { date: "2099-01-01" }, tokenB);

    if (entryB === null) {
      results.push({
        name: "User isolation - entries.getByDate",
        status: "PASS",
        details: "User B correctly CANNOT see User A's entry",
      });
      console.log("  ✓ User B correctly CANNOT see User A's entry");
    } else {
      results.push({
        name: "User isolation - entries.getByDate",
        status: "CRITICAL_FAIL",
        details: `SECURITY BREACH! User B CAN see User A's entry: ${entryB.content}`,
      });
      console.log(`  ✗ SECURITY BREACH! User B CAN see User A's entry!`);
    }
  } catch (e: any) {
    results.push({
      name: "User isolation - entries.getByDate",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 2: User A creates entry, User B cannot delete it
  // ================================================================
  console.log("\n[TEST 2] User B tries to delete User A's entry...");
  try {
    // User B tries to delete User A's entry
    await trpcMutation("entries.delete", { date: "2099-01-01" }, tokenB);
    console.log("  User B attempted delete");

    // Verify User A's entry still exists
    const entryA = await trpcQuery("entries.getByDate", { date: "2099-01-01" }, tokenA);

    if (entryA !== null) {
      results.push({
        name: "User isolation - entries.delete",
        status: "PASS",
        details: "User A's entry still exists after User B's delete attempt",
      });
      console.log("  ✓ User A's entry still exists (User B's delete had no effect)");
    } else {
      results.push({
        name: "User isolation - entries.delete",
        status: "CRITICAL_FAIL",
        details: "SECURITY BREACH! User B was able to delete User A's entry!",
      });
      console.log("  ✗ SECURITY BREACH! User B deleted User A's entry!");
    }
  } catch (e: any) {
    results.push({
      name: "User isolation - entries.delete",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 3: Both users can have entries for same date
  // ================================================================
  console.log("\n[TEST 3] Both users create entries for same date...");
  try {
    // User B creates entry for same date
    const entryB = await trpcMutation(
      "entries.upsert",
      { date: "2099-01-01", content: "User B's entry for same date" },
      tokenB
    );
    console.log(`  ✓ User B created entry: ${entryB.id}`);

    // Verify both entries exist independently
    const userAEntry = await trpcQuery("entries.getByDate", { date: "2099-01-01" }, tokenA);
    const userBEntry = await trpcQuery("entries.getByDate", { date: "2099-01-01" }, tokenB);

    if (
      userAEntry &&
      userBEntry &&
      userAEntry.content.includes("User A") &&
      userBEntry.content.includes("User B")
    ) {
      results.push({
        name: "Multi-user same date entries",
        status: "PASS",
        details: `User A: "${userAEntry.content.substring(0, 20)}...", User B: "${userBEntry.content.substring(0, 20)}..."`,
      });
      console.log("  ✓ Both users have separate entries for same date");
    } else {
      results.push({
        name: "Multi-user same date entries",
        status: "CRITICAL_FAIL",
        details: "Data isolation failed - entries are mixed!",
      });
      console.log("  ✗ Data isolation failed!");
    }
  } catch (e: any) {
    results.push({
      name: "Multi-user same date entries",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 4: entries.list only shows own entries
  // ================================================================
  console.log("\n[TEST 4] entries.list only shows own entries...");
  try {
    const listA = await trpcQuery("entries.list", { limit: 50 }, tokenA);
    const listB = await trpcQuery("entries.list", { limit: 50 }, tokenB);

    console.log(`  User A sees ${listA.items.length} entries`);
    console.log(`  User B sees ${listB.items.length} entries`);

    // Check if User A's list contains User B's content
    const leakToA = listA.items.some((e: any) => e.content?.includes("User B"));
    const leakToB = listB.items.some((e: any) => e.content?.includes("User A"));

    if (!leakToA && !leakToB) {
      results.push({
        name: "User isolation - entries.list",
        status: "PASS",
        details: `User A sees ${listA.items.length} entries, User B sees ${listB.items.length} entries - no cross-contamination`,
      });
      console.log("  ✓ No cross-user data leakage in list results");
    } else {
      results.push({
        name: "User isolation - entries.list",
        status: "CRITICAL_FAIL",
        details: `Data leakage detected! A sees B's data: ${leakToA}, B sees A's data: ${leakToB}`,
      });
      console.log("  ✗ SECURITY BREACH! Data leakage detected!");
    }
  } catch (e: any) {
    results.push({
      name: "User isolation - entries.list",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 5: Config (skipDays) isolation
  // ================================================================
  console.log("\n[TEST 5] Config (skipDays) isolation...");
  try {
    // User A adds skip day
    await trpcMutation("config.addSkipWeekday", { weekday: 1 }, tokenA); // Monday
    console.log("  User A added Monday as skip day");

    // User B's skip days should not include User A's
    const skipB = await trpcQuery("config.getSkipDays", undefined, tokenB);
    console.log(`  User B's skip weekdays: ${skipB.weekdays}`);

    if (!skipB.weekdays.includes(1)) {
      results.push({
        name: "User isolation - config.skipDays",
        status: "PASS",
        details: "User B does not see User A's skip day settings",
      });
      console.log("  ✓ User B does not see User A's skip days");
    } else {
      results.push({
        name: "User isolation - config.skipDays",
        status: "CRITICAL_FAIL",
        details: "User B can see User A's skip day settings!",
      });
      console.log("  ✗ SECURITY BREACH! User B sees User A's skip days!");
    }
  } catch (e: any) {
    results.push({
      name: "User isolation - config.skipDays",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 6: Templates isolation
  // ================================================================
  console.log("\n[TEST 6] Templates isolation...");
  try {
    // User A creates template
    await trpcMutation(
      "config.createTemplate",
      { name: "User A Secret Template", content: "SECRET TEMPLATE CONTENT" },
      tokenA
    );
    console.log("  User A created secret template");

    // User B's templates should not include User A's
    const templatesB = await trpcQuery("config.getTemplates", undefined, tokenB);
    const hasUserATemplate = templatesB.some((t: any) =>
      t.name.includes("User A")
    );

    if (!hasUserATemplate) {
      results.push({
        name: "User isolation - config.templates",
        status: "PASS",
        details: `User B sees ${templatesB.length} templates, none from User A`,
      });
      console.log("  ✓ User B does not see User A's templates");
    } else {
      results.push({
        name: "User isolation - config.templates",
        status: "CRITICAL_FAIL",
        details: "User B can see User A's templates!",
      });
      console.log("  ✗ SECURITY BREACH! User B sees User A's templates!");
    }
  } catch (e: any) {
    results.push({
      name: "User isolation - config.templates",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // TEST 7: Verify DB directly
  // ================================================================
  console.log("\n[TEST 7] Direct DB verification...");
  try {
    const dbCheck = new Database(DB_PATH);

    // Check entries have correct user_id
    const entries = dbCheck
      .prepare("SELECT id, date, user_id, content FROM entries WHERE date = '2099-01-01'")
      .all() as Array<{ id: string; date: string; user_id: string; content: string }>;

    console.log(`  Found ${entries.length} entries for 2099-01-01:`);
    for (const e of entries) {
      console.log(`    - userId=${e.user_id}, content=${e.content.substring(0, 30)}...`);
    }

    const userAEntries = entries.filter((e) => e.user_id === userA);
    const userBEntries = entries.filter((e) => e.user_id === userB);

    if (userAEntries.length === 1 && userBEntries.length === 1) {
      results.push({
        name: "Database isolation verification",
        status: "PASS",
        details: `User A has ${userAEntries.length} entry, User B has ${userBEntries.length} entry for same date`,
      });
      console.log("  ✓ Database correctly stores separate entries per user");
    } else {
      results.push({
        name: "Database isolation verification",
        status: "FAIL",
        details: `Expected 1 entry per user, got A:${userAEntries.length}, B:${userBEntries.length}`,
      });
    }

    dbCheck.close();
  } catch (e: any) {
    results.push({
      name: "Database isolation verification",
      status: "FAIL",
      details: e.message,
    });
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log("\n" + "=".repeat(60));
  console.log("MULTI-USER ISOLATION TEST RESULTS");
  console.log("=".repeat(60));

  let passed = 0,
    failed = 0,
    critical = 0;
  for (const result of results) {
    const icon =
      result.status === "PASS"
        ? "✅"
        : result.status === "CRITICAL_FAIL"
          ? "🚨"
          : "❌";
    console.log(`${icon} ${result.name}: ${result.status}`);
    console.log(`   ${result.details}`);
    if (result.status === "PASS") passed++;
    else if (result.status === "CRITICAL_FAIL") critical++;
    else failed++;
  }

  console.log("\n" + "-".repeat(60));
  console.log(
    `Total: ${results.length} | ✅ Pass: ${passed} | ❌ Fail: ${failed} | 🚨 Critical: ${critical}`
  );
  console.log("-".repeat(60));

  if (critical > 0) {
    console.log("\n🚨🚨🚨 CRITICAL SECURITY FAILURES DETECTED 🚨🚨🚨");
    console.log("User data is NOT properly isolated!");
  } else if (failed > 0) {
    console.log("\n⚠️ Some tests failed, but no critical security issues.");
  } else {
    console.log("\n✅ All tests passed! User data is properly isolated.");
  }

  // Cleanup test data
  const cleanupDb = new Database(DB_PATH);
  cleanupDb.prepare("DELETE FROM entries WHERE date LIKE '2099-%'").run();
  cleanupDb.prepare("DELETE FROM skip_days WHERE user_id IN (?, ?)").run(userA, userB);
  cleanupDb.prepare("DELETE FROM templates WHERE user_id IN (?, ?)").run(userA, userB);
  cleanupDb.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userA, userB);
  cleanupDb.close();
  console.log("\nTest data cleaned up.");

  process.exit(critical > 0 ? 2 : failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Test suite failed:", e);
  process.exit(1);
});
