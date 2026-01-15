/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

console.log("🚀 Service Worker script loaded!");

import initSqlJs, { type Database } from "sql.js";
import {
  loadFromIndexedDB,
  saveToIndexedDB,
  setCurrentUserId,
  hasUserData,
  migrateAnonymousToUser,
  clearUserDatabase,
} from "./worker/persistence";

const SW_VERSION = "2026-01-15-v4";
const CACHE_NAME = "til-stack-v1";
const SYNC_TAG = "til-stack-sync";

// Current state
let sqliteDb: Database | null = null;
let currentUserId: string | null = null;
let isOnline = true;
let syncInProgress = false;

// Pending operation types
type PendingOperation = {
  id: string;
  type: "upsert" | "delete";
  date: string;
  content?: string;
  createdAt: string;
};

// API base URL (for sync operations)
const API_URL = ""; // Empty means same origin, will be proxied

// Entry type for sync
interface SyncEntry {
  id: string;
  date: string;
  content: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Initialize sql.js and load database for current user
async function initDatabase(): Promise<Database> {
  if (sqliteDb) {
    console.log("[SW] Database already initialized");
    return sqliteDb;
  }

  console.log("[SW] Initializing database...");

  // Try to load wasm from cache first (for offline support)
  let wasmBinary: ArrayBuffer | undefined;
  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match("/sql.js/sql-wasm.wasm");
    if (cachedResponse) {
      console.log("[SW] Loading wasm from cache");
      wasmBinary = await cachedResponse.arrayBuffer();
    }
  } catch (e) {
    console.log("[SW] Cache miss for wasm, will fetch from network");
  }

  const SQL = await initSqlJs({
    locateFile: (file) => {
      console.log("[SW] sql.js locateFile:", file);
      return `/sql.js/${file}`;
    },
    wasmBinary,
  });
  console.log("[SW] sql.js loaded");

  // Load data for current user (null = anonymous)
  const savedData = await loadFromIndexedDB(currentUserId);
  console.log("[SW] IndexedDB data:", savedData ? `${savedData.length} bytes` : "none");
  sqliteDb = savedData ? new SQL.Database(savedData) : new SQL.Database();

  // Create tables if they don't exist
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skip_days (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_pending (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return sqliteDb;
}

// Close and clear current database instance
function closeDatabase(): void {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
}

// Persist database to IndexedDB for current user
async function persistDatabase(): Promise<void> {
  if (!sqliteDb) return;
  const data = sqliteDb.export();
  await saveToIndexedDB(data, currentUserId);
}

// Switch to a different user's database
async function switchToUser(userId: string | null): Promise<void> {
  console.log(`[SW] Switching to user: ${userId || "anonymous"}`);

  // Close current database
  closeDatabase();

  // Update current user
  currentUserId = userId;
  setCurrentUserId(userId);

  // Database will be initialized on next request
}

// ====== PENDING OPERATIONS ======

// Add a pending operation (when offline)
async function addPendingOperation(op: Omit<PendingOperation, "id" | "createdAt">): Promise<void> {
  const db = await initDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Check if there's already a pending operation for this date
  db.run(`DELETE FROM sync_pending WHERE date = ?`, [op.date]);

  db.run(
    `INSERT INTO sync_pending (id, type, date, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, op.type, op.date, op.content ?? null, now]
  );
  await persistDatabase();
  console.log(`[SW] Added pending ${op.type} for date ${op.date}`);
}

// Get all pending operations
async function getPendingOperations(): Promise<PendingOperation[]> {
  const db = await initDatabase();
  const results = db.exec(`SELECT * FROM sync_pending ORDER BY created_at ASC`);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    type: row[1] as "upsert" | "delete",
    date: row[2] as string,
    content: row[3] as string | undefined,
    createdAt: row[4] as string,
  })) || [];
}

// Clear a specific pending operation
async function clearPendingOperation(id: string): Promise<void> {
  const db = await initDatabase();
  db.run(`DELETE FROM sync_pending WHERE id = ?`, [id]);
  await persistDatabase();
}

// Clear all pending operations
async function clearAllPendingOperations(): Promise<void> {
  const db = await initDatabase();
  db.run(`DELETE FROM sync_pending`);
  await persistDatabase();
}

// Check if there are pending operations
async function hasPendingOperations(): Promise<boolean> {
  const db = await initDatabase();
  const results = db.exec(`SELECT COUNT(*) FROM sync_pending`);
  const count = results[0]?.values[0]?.[0] as number || 0;
  return count > 0;
}

// Register for background sync (if supported)
async function registerBackgroundSync(): Promise<boolean> {
  try {
    const registration = self.registration;
    if ("sync" in registration) {
      await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(SYNC_TAG);
      console.log(`[SW] Background sync registered: ${SYNC_TAG}`);
      return true;
    }
  } catch (error) {
    console.warn("[SW] Background sync registration failed:", error);
  }
  return false;
}

// Update online status based on fetch result
function updateOnlineStatus(online: boolean): void {
  if (isOnline !== online) {
    console.log(`[SW] Online status changed: ${isOnline} -> ${online}`);
    isOnline = online;

    // If back online and logged in, try to sync
    if (online && currentUserId) {
      processPendingOperations().catch((err) => {
        console.warn("[SW] Auto-sync on reconnect failed:", err);
      });
    }
  }
}

// Process all pending operations
async function processPendingOperations(): Promise<{ synced: number; failed: number }> {
  if (!isOnline || !currentUserId) {
    console.log("[SW] Skipping pending ops: offline or not logged in");
    return { synced: 0, failed: 0 };
  }

  if (syncInProgress) {
    console.log("[SW] Sync already in progress");
    return { synced: 0, failed: 0 };
  }

  syncInProgress = true;
  console.log("[SW] Processing pending operations...");

  let synced = 0;
  let failed = 0;

  try {
    const pending = await getPendingOperations();
    console.log(`[SW] Found ${pending.length} pending operations`);

    for (const op of pending) {
      try {
        if (op.type === "upsert" && op.content !== undefined) {
          await pushEntryToServer({ date: op.date, content: op.content });
          console.log(`[SW] Synced upsert for ${op.date}`);
        } else if (op.type === "delete") {
          await fetch(`${API_URL}/trpc/entries.delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ "0": { date: op.date } }),
          });
          console.log(`[SW] Synced delete for ${op.date}`);
        }

        await clearPendingOperation(op.id);
        synced++;
      } catch (error) {
        console.error(`[SW] Failed to sync op ${op.id}:`, error);
        failed++;
        // Don't clear failed operations - they'll be retried
      }
    }

    console.log(`[SW] Pending ops complete: synced=${synced}, failed=${failed}`);
  } finally {
    syncInProgress = false;
  }

  return { synced, failed };
}

// ====== SYNC FUNCTIONS ======

// Fetch entries from server
async function fetchServerEntries(): Promise<SyncEntry[]> {
  try {
    const response = await fetch(`${API_URL}/trpc/entries.list?input=${encodeURIComponent(JSON.stringify({ "0": { limit: 1000 } }))}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const items = data.result?.data?.items || [];

    return items.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      date: item.date as string,
      content: item.content as string,
      userId: (item.userId as string) ?? null,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    }));
  } catch (error) {
    console.error("[SW] Failed to fetch server entries:", error);
    throw error;
  }
}

// Push entry to server
async function pushEntryToServer(entry: { date: string; content: string }): Promise<SyncEntry> {
  const response = await fetch(`${API_URL}/trpc/entries.upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ "0": entry }),
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  const data = await response.json();
  const result = data.result?.data;

  return {
    id: result.id,
    date: result.date,
    content: result.content,
    userId: result.userId ?? null,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

// Get all local entries
function getLocalEntries(db: Database): SyncEntry[] {
  const results = db.exec(`SELECT * FROM entries ORDER BY date DESC`);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  })) || [];
}

// Update local entry from server data
function updateLocalEntry(db: Database, entry: SyncEntry): void {
  const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [entry.date]);

  if (existing[0]?.values[0]) {
    db.run(
      `UPDATE entries SET content = ?, updated_at = ?, user_id = ? WHERE date = ?`,
      [entry.content, entry.updatedAt, entry.userId, entry.date]
    );
  } else {
    db.run(
      `INSERT INTO entries (id, date, content, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.date, entry.content, entry.userId, entry.createdAt, entry.updatedAt]
    );
  }
}

// Pull data from server and update local
async function pullFromServer(): Promise<number> {
  if (!isOnline) {
    console.log("[SW] Offline, skipping pull");
    return 0;
  }

  console.log("[SW] Pulling from server...");
  const db = await initDatabase();

  try {
    const serverEntries = await fetchServerEntries();
    console.log(`[SW] Got ${serverEntries.length} entries from server`);

    for (const entry of serverEntries) {
      updateLocalEntry(db, entry);
    }

    await persistDatabase();
    console.log(`[SW] Pull complete: ${serverEntries.length} entries`);
    return serverEntries.length;
  } catch (error) {
    console.error("[SW] Pull failed:", error);
    throw error;
  }
}

// Push local data to server
async function pushToServer(): Promise<number> {
  if (!isOnline) {
    console.log("[SW] Offline, skipping push");
    return 0;
  }

  console.log("[SW] Pushing to server...");
  const db = await initDatabase();

  try {
    const localEntries = getLocalEntries(db);
    console.log(`[SW] Pushing ${localEntries.length} local entries`);

    let pushed = 0;
    for (const entry of localEntries) {
      await pushEntryToServer({ date: entry.date, content: entry.content });
      pushed++;
    }

    console.log(`[SW] Push complete: ${pushed} entries`);
    return pushed;
  } catch (error) {
    console.error("[SW] Push failed:", error);
    throw error;
  }
}

// Full sync: process pending ops, push all, then pull
async function fullSync(): Promise<{ pushed: number; pulled: number; pendingSynced: number }> {
  if (syncInProgress) {
    console.log("[SW] Sync already in progress");
    return { pushed: 0, pulled: 0, pendingSynced: 0 };
  }

  syncInProgress = true;
  console.log("[SW] Starting full sync...");

  try {
    // First process any pending operations from offline period
    const pendingResult = await processPendingOperationsInternal();
    const pendingSynced = pendingResult.synced;

    // Then push all local entries
    const pushed = await pushToServer();
    const pulled = await pullFromServer();

    console.log(`[SW] Full sync complete: pendingSynced=${pendingSynced}, pushed=${pushed}, pulled=${pulled}`);
    return { pushed, pulled, pendingSynced };
  } finally {
    syncInProgress = false;
  }
}

// Internal version of processPendingOperations that doesn't check syncInProgress
async function processPendingOperationsInternal(): Promise<{ synced: number; failed: number }> {
  if (!isOnline || !currentUserId) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  const pending = await getPendingOperations();
  console.log(`[SW] Processing ${pending.length} pending operations`);

  for (const op of pending) {
    try {
      if (op.type === "upsert" && op.content !== undefined) {
        await pushEntryToServer({ date: op.date, content: op.content });
      } else if (op.type === "delete") {
        await fetch(`${API_URL}/trpc/entries.delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ "0": { date: op.date } }),
        });
      }
      await clearPendingOperation(op.id);
      synced++;
    } catch (error) {
      console.error(`[SW] Failed to sync op ${op.id}:`, error);
      failed++;
    }
  }

  return { synced, failed };
}

// Handle user login
async function handleUserLogin(userId: string, isNewUser: boolean): Promise<{ migrated: boolean; pulled: number }> {
  console.log(`[SW] User login: ${userId}, isNewUser: ${isNewUser}`);

  let migrated = false;

  if (isNewUser) {
    // New user: migrate anonymous data to their namespace, then push to server
    console.log("[SW] New user - migrating anonymous data");
    migrated = await migrateAnonymousToUser(userId);

    // Switch to user's database
    await switchToUser(userId);

    // Push migrated data to server, then pull merged result
    if (migrated && isOnline) {
      try {
        await fullSync();
      } catch (error) {
        console.warn("[SW] Initial sync failed:", error);
      }
    }
  } else {
    // Existing user (possibly on new device): pull from server only
    console.log("[SW] Existing user - pulling from server");

    // Switch to user's database
    await switchToUser(userId);

    // Pull server data (don't push - we might have empty local DB)
    if (isOnline) {
      try {
        const pulled = await pullFromServer();
        return { migrated: false, pulled };
      } catch (error) {
        console.warn("[SW] Pull failed:", error);
      }
    }
  }

  return { migrated, pulled: 0 };
}

// Handle user logout
async function handleUserLogout(): Promise<void> {
  console.log("[SW] User logout");

  // Switch back to anonymous user
  await switchToUser(null);
}

// ====== REQUEST HANDLERS ======

// Simple tRPC-like request handler for local database
async function handleLocalRequest(
  procedure: string,
  input: unknown
): Promise<unknown> {
  const db = await initDatabase();

  // Parse procedure path (e.g., "entries.list", "config.getSkipDays")
  const [router, method] = procedure.split(".");

  switch (router) {
    case "entries":
      return handleEntries(db, method, input);
    case "config":
      return handleConfig(db, method, input);
    case "webhooks":
      // Webhooks are not available in local mode
      return { error: "Webhooks require login" };
    case "auth":
      // In local-first mode, user is not logged in
      // Return null for auth.me (same as server when not logged in)
      return null;
    default:
      return { error: `Unknown router: ${router}` };
  }
}

async function handleEntries(db: Database, method: string, input: unknown): Promise<unknown> {
  switch (method) {
    case "list": {
      const { cursor, limit = 20 } = (input as { cursor?: string; limit?: number }) || {};
      const query = cursor
        ? `SELECT * FROM entries WHERE date < ? ORDER BY date DESC LIMIT ?`
        : `SELECT * FROM entries ORDER BY date DESC LIMIT ?`;
      const params = cursor ? [cursor, limit + 1] : [limit + 1];
      const results = db.exec(query, params);
      const items = results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];
      const hasMore = items.length > limit;
      if (hasMore) items.pop();
      return {
        items,
        hasMore,
        nextCursor: hasMore && items.length > 0 ? items[items.length - 1].date : undefined,
      };
    }
    case "getByDate": {
      const { date } = input as { date: string };
      const results = db.exec(`SELECT * FROM entries WHERE date = ?`, [date]);
      if (results[0]?.values[0]) {
        const row = results[0].values[0];
        return {
          id: row[0],
          date: row[1],
          content: row[2],
          userId: row[3],
          createdAt: row[4],
          updatedAt: row[5],
        };
      }
      return null;
    }
    case "upsert": {
      const { date, content } = input as { date: string; content: string };
      const now = new Date().toISOString();
      const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [date]);
      if (existing[0]?.values[0]) {
        db.run(`UPDATE entries SET content = ?, updated_at = ? WHERE date = ?`, [
          content,
          now,
          date,
        ]);
      } else {
        const id = crypto.randomUUID();
        db.run(
          `INSERT INTO entries (id, date, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [id, date, content, now, now]
        );
      }
      await persistDatabase();

      // If logged in, sync this entry to server
      if (currentUserId) {
        if (isOnline) {
          // Online: push directly
          pushEntryToServer({ date, content }).catch((err) => {
            console.warn("[SW] Background push failed:", err);
            // If push fails, add to pending and mark offline
            updateOnlineStatus(false);
            addPendingOperation({ type: "upsert", date, content });
            registerBackgroundSync();
          });
        } else {
          // Offline: add to pending operations
          await addPendingOperation({ type: "upsert", date, content });
          await registerBackgroundSync();
          console.log(`[SW] Offline: queued upsert for ${date}`);
        }
      }

      const result = db.exec(`SELECT * FROM entries WHERE date = ?`, [date]);
      const row = result[0].values[0];
      return {
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      };
    }
    case "delete": {
      const { date } = input as { date: string };
      db.run(`DELETE FROM entries WHERE date = ?`, [date]);
      await persistDatabase();

      // If logged in, delete on server too
      if (currentUserId) {
        if (isOnline) {
          // Online: delete directly
          fetch(`${API_URL}/trpc/entries.delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ "0": { date } }),
          }).catch((err) => {
            console.warn("[SW] Background delete failed:", err);
            // If delete fails, add to pending and mark offline
            updateOnlineStatus(false);
            addPendingOperation({ type: "delete", date });
            registerBackgroundSync();
          });
        } else {
          // Offline: add to pending operations
          await addPendingOperation({ type: "delete", date });
          await registerBackgroundSync();
          console.log(`[SW] Offline: queued delete for ${date}`);
        }
      }

      return { success: true };
    }
    case "getByDateRange": {
      const { startDate, endDate } = input as { startDate: string; endDate: string };
      const results = db.exec(
        `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
        [startDate, endDate]
      );
      return results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];
    }
    case "getWeeklySummary": {
      const { weekStart } = input as { weekStart: string };
      const weekStartDate = new Date(weekStart);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const weekEndStr = weekEndDate.toISOString().split("T")[0];

      const results = db.exec(
        `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
        [weekStart, weekEndStr]
      );
      const entries = results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];

      return {
        weekStart,
        weekEnd: weekEndStr,
        entries,
        totalEntries: entries.length,
      };
    }
    case "getMonthlySummary": {
      const { month } = input as { month: string };
      const [year, monthNum] = month.split("-").map(Number);
      const startDate = `${month}-01`;
      const lastDay = new Date(year, monthNum, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

      const results = db.exec(
        `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
        [startDate, endDate]
      );
      const entries = results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];

      // Group entries by week
      interface WeekGroup {
        weekStart: string;
        weekEnd: string;
        entries: typeof entries;
      }
      const weeks: WeekGroup[] = [];
      const currentWeekStart = new Date(startDate);
      // Adjust to Monday
      const day = currentWeekStart.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      currentWeekStart.setDate(currentWeekStart.getDate() + diff);

      while (currentWeekStart <= new Date(endDate)) {
        const weekEndDate = new Date(currentWeekStart);
        weekEndDate.setDate(weekEndDate.getDate() + 6);

        const weekStartStr = currentWeekStart.toISOString().split("T")[0];
        const weekEndStr = weekEndDate.toISOString().split("T")[0];

        const weekEntries = entries.filter(
          (e) => e.date && e.date >= weekStartStr && e.date <= weekEndStr
        );

        if (weekEntries.length > 0 || (weekStartStr >= startDate && weekStartStr <= endDate)) {
          weeks.push({
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            entries: weekEntries,
          });
        }

        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      }

      return {
        month,
        entries,
        totalEntries: entries.length,
        weeks,
      };
    }
    default:
      return { error: `Unknown method: ${method}` };
  }
}

async function handleConfig(db: Database, method: string, input: unknown): Promise<unknown> {
  switch (method) {
    case "getSkipDays": {
      const results = db.exec(`SELECT * FROM skip_days`);
      const raw = results[0]?.values.map((row) => ({
        id: row[0],
        type: row[1],
        value: row[2],
        userId: row[3],
        createdAt: row[4],
      })) || [];
      const weekdays = raw
        .filter((s) => s.type === "weekday")
        .map((s) => parseInt(s.value as string));
      const specificDates = raw
        .filter((s) => s.type === "specific_date")
        .map((s) => s.value as string);
      return { weekdays, specificDates, raw };
    }
    case "getTemplates": {
      const results = db.exec(`SELECT * FROM templates ORDER BY name`);
      return results[0]?.values.map((row) => ({
        id: row[0],
        name: row[1],
        content: row[2],
        isDefault: Boolean(row[3]),
        userId: row[4],
        createdAt: row[5],
        updatedAt: row[6],
      })) || [];
    }
    case "getDefaultTemplate": {
      const results = db.exec(`SELECT * FROM templates WHERE is_default = 1 LIMIT 1`);
      if (results[0]?.values[0]) {
        const row = results[0].values[0];
        return {
          id: row[0],
          name: row[1],
          content: row[2],
          isDefault: Boolean(row[3]),
          userId: row[4],
          createdAt: row[5],
          updatedAt: row[6],
        };
      }
      return null;
    }
    case "addSkipWeekday": {
      const { weekday } = input as { weekday: number };
      const existing = db.exec(
        `SELECT id FROM skip_days WHERE type = 'weekday' AND value = ?`,
        [weekday.toString()]
      );
      if (existing[0]?.values[0]) {
        const row = existing[0].values[0];
        return { id: row[0], type: "weekday", value: weekday.toString() };
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO skip_days (id, type, value, created_at) VALUES (?, 'weekday', ?, ?)`,
        [id, weekday.toString(), now]
      );
      await persistDatabase();
      return { id, type: "weekday", value: weekday.toString(), createdAt: now };
    }
    case "addSkipDate": {
      const { date } = input as { date: string };
      const existing = db.exec(
        `SELECT id FROM skip_days WHERE type = 'specific_date' AND value = ?`,
        [date]
      );
      if (existing[0]?.values[0]) {
        const row = existing[0].values[0];
        return { id: row[0], type: "specific_date", value: date };
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO skip_days (id, type, value, created_at) VALUES (?, 'specific_date', ?, ?)`,
        [id, date, now]
      );
      await persistDatabase();
      return { id, type: "specific_date", value: date, createdAt: now };
    }
    case "removeSkipDay": {
      const { id } = input as { id: string };
      db.run(`DELETE FROM skip_days WHERE id = ?`, [id]);
      await persistDatabase();
      return { success: true };
    }
    case "createTemplate": {
      const { name, content } = input as { name: string; content: string };
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO templates (id, name, content, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
        [id, name, content, now, now]
      );
      await persistDatabase();
      return { id, name, content, isDefault: false, createdAt: now, updatedAt: now };
    }
    case "updateTemplate": {
      const { id, name, content } = input as { id: string; name?: string; content?: string };
      const now = new Date().toISOString();
      if (name !== undefined) {
        db.run(`UPDATE templates SET name = ?, updated_at = ? WHERE id = ?`, [name, now, id]);
      }
      if (content !== undefined) {
        db.run(`UPDATE templates SET content = ?, updated_at = ? WHERE id = ?`, [content, now, id]);
      }
      await persistDatabase();
      const result = db.exec(`SELECT * FROM templates WHERE id = ?`, [id]);
      if (result[0]?.values[0]) {
        const row = result[0].values[0];
        return {
          id: row[0],
          name: row[1],
          content: row[2],
          isDefault: Boolean(row[3]),
          userId: row[4],
          createdAt: row[5],
          updatedAt: row[6],
        };
      }
      return null;
    }
    case "deleteTemplate": {
      const { id } = input as { id: string };
      db.run(`DELETE FROM templates WHERE id = ?`, [id]);
      await persistDatabase();
      return { success: true };
    }
    case "setDefaultTemplate": {
      const { id } = input as { id: string | null };
      const now = new Date().toISOString();
      db.run(`UPDATE templates SET is_default = 0, updated_at = ?`, [now]);
      if (id) {
        db.run(`UPDATE templates SET is_default = 1, updated_at = ? WHERE id = ?`, [now, id]);
      }
      await persistDatabase();
      return { success: true };
    }
    default:
      return { error: `Unknown method: ${method}` };
  }
}

// Handle tRPC batch requests
async function handleTRPCRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace("/trpc/", "");

  // Handle batch requests
  if (request.method === "GET") {
    const inputParam = url.searchParams.get("input");
    const input = inputParam ? JSON.parse(inputParam) : {};

    // Single query
    if (!pathname.includes(",")) {
      const result = await handleLocalRequest(pathname, input["0"] || input);
      return new Response(
        JSON.stringify({
          result: { data: result },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Batch queries
    const procedures = pathname.split(",");
    const results = await Promise.all(
      procedures.map((proc, i) =>
        handleLocalRequest(proc, input[String(i)] || {})
      )
    );

    return new Response(
      JSON.stringify(results.map((data) => ({ result: { data } }))),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Mutations
  if (request.method === "POST") {
    const body = await request.json();
    const input = body["0"] || body;
    const result = await handleLocalRequest(pathname, input);

    return new Response(
      JSON.stringify({
        result: { data: result },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response("Method not allowed", { status: 405 });
}

// ====== SERVICE WORKER EVENT HANDLERS ======

self.addEventListener("install", (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}...`);
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}...`);
  event.waitUntil(self.clients.claim());
});

// Background Sync event - fires when device comes back online
self.addEventListener("sync", (event: SyncEvent) => {
  console.log(`[SW] Sync event received: ${event.tag}`);

  if (event.tag === SYNC_TAG) {
    event.waitUntil(
      (async () => {
        console.log("[SW] Processing background sync...");
        updateOnlineStatus(true);

        const result = await processPendingOperations();
        console.log(`[SW] Background sync complete: synced=${result.synced}, failed=${result.failed}`);

        // If there are still failures, reject to retry later
        if (result.failed > 0) {
          throw new Error(`${result.failed} operations failed`);
        }
      })()
    );
  }
});

// SyncEvent type for TypeScript
interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener("message", async (event) => {
  const { type } = event.data;

  if (type === "USER_LOGIN") {
    // New login message format with more info
    const { userId, isNewUser } = event.data;
    console.log(`[SW] USER_LOGIN: userId=${userId}, isNewUser=${isNewUser}`);

    try {
      const result = await handleUserLogin(userId, isNewUser);
      event.ports[0]?.postMessage({ success: true, ...result });
    } catch (error) {
      console.error("[SW] Login handling failed:", error);
      event.ports[0]?.postMessage({ success: false, error: String(error) });
    }
  } else if (type === "USER_LOGGED_IN") {
    // Legacy compatibility - treat as existing user login
    const { userId } = event.data;
    if (userId) {
      await handleUserLogin(userId, false);
    }
    console.log("[SW] User logged in (legacy)");
  } else if (type === "USER_LOGGED_OUT") {
    await handleUserLogout();
    console.log("[SW] User logged out");
  } else if (type === "SYNC_NOW") {
    // Manual sync trigger
    console.log("[SW] Manual sync requested");
    try {
      const result = await fullSync();
      event.ports[0]?.postMessage({ success: true, ...result });
    } catch (error) {
      console.error("[SW] Sync failed:", error);
      event.ports[0]?.postMessage({ success: false, error: String(error) });
    }
  } else if (type === "CLEAR_LOCAL_DATA") {
    // Clear current user's data
    console.log("[SW] Clearing local data...");
    try {
      await clearUserDatabase(currentUserId);
      closeDatabase();
      event.ports[0]?.postMessage({ success: true });
      console.log("[SW] Local data cleared");
    } catch (error) {
      console.error("[SW] Clear local data failed:", error);
      event.ports[0]?.postMessage({ success: false, error: String(error) });
    }
  } else if (type === "UPDATE_ENTRY") {
    // Update local entry from server (for sync pull)
    console.log("[SW] Updating local entry from server");
    try {
      const db = await initDatabase();
      const { entry } = event.data;
      updateLocalEntry(db, entry);
      await persistDatabase();
      event.ports[0]?.postMessage({ success: true });
    } catch (error) {
      console.error("[SW] Update entry failed:", error);
      event.ports[0]?.postMessage({ success: false, error: String(error) });
    }
  } else if (type === "EXPORT_DATA") {
    // Export all data for migration
    console.log("[SW] Exporting data for migration");
    try {
      const db = await initDatabase();
      const entries = db.exec(`SELECT * FROM entries`);
      const skipDays = db.exec(`SELECT * FROM skip_days`);
      const templates = db.exec(`SELECT * FROM templates`);

      const entriesList = entries[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];

      const skipDaysList = skipDays[0]?.values.map((row) => ({
        id: row[0],
        type: row[1],
        value: row[2],
        userId: row[3],
        createdAt: row[4],
      })) || [];

      const templatesList = templates[0]?.values.map((row) => ({
        id: row[0],
        name: row[1],
        content: row[2],
        isDefault: Boolean(row[3]),
        userId: row[4],
        createdAt: row[5],
        updatedAt: row[6],
      })) || [];

      event.ports[0]?.postMessage({
        entries: entriesList,
        skipDays: skipDaysList,
        templates: templatesList,
      });
    } catch (error) {
      console.error("[SW] Export failed:", error);
      event.ports[0]?.postMessage(null);
    }
  } else if (type === "CHECK_USER_DATA") {
    // Check if user has existing data
    const { userId } = event.data;
    try {
      const hasData = await hasUserData(userId);
      event.ports[0]?.postMessage({ hasData });
    } catch (error) {
      event.ports[0]?.postMessage({ hasData: false, error: String(error) });
    }
  } else if (type === "CHECK_PENDING_SYNC") {
    // Check pending sync status
    try {
      const pending = await getPendingOperations();
      event.ports[0]?.postMessage({
        hasPending: pending.length > 0,
        pendingCount: pending.length,
        isOnline,
      });
    } catch (error) {
      event.ports[0]?.postMessage({ hasPending: false, pendingCount: 0, error: String(error) });
    }
  } else if (type === "RETRY_SYNC") {
    // Manual retry for pending operations (fallback when Background Sync not supported)
    console.log("[SW] Manual retry sync requested");
    try {
      updateOnlineStatus(true);
      const result = await processPendingOperations();
      event.ports[0]?.postMessage({ success: true, ...result });
    } catch (error) {
      console.error("[SW] Retry sync failed:", error);
      event.ports[0]?.postMessage({ success: false, error: String(error) });
    }
  } else if (type === "SET_ONLINE_STATUS") {
    // Manual online status update (from frontend navigator.onLine events)
    const { online } = event.data;
    updateOnlineStatus(online);
    event.ports[0]?.postMessage({ success: true, isOnline });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Debug: Log ALL fetch events
  console.log(`[SW ${SW_VERSION}] Fetch event:`, url.pathname);

  // Local-first: Always intercept /trpc requests (except pure auth/webhook batches)
  if (url.pathname.startsWith("/trpc")) {
    const procedures = url.pathname.replace("/trpc/", "").split(",");
    console.log("[SW] tRPC procedures:", procedures);

    // Check if ALL procedures are auth or webhooks (need server)
    const allServerOnly = procedures.every(
      (proc) => proc.startsWith("auth.") || proc.startsWith("webhooks.")
    );

    // Only let through if ALL procedures need server
    if (allServerOnly) {
      console.log("[SW] All server-only, passing through to network");
      return;
    }

    console.log("[SW] Intercepting:", url.pathname);
    event.respondWith(
      handleTRPCRequest(event.request).catch((err) => {
        console.error("[SW] handleTRPCRequest error:", err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }
  // Other requests (static files, etc.) go to network
  console.log("[SW] Passing through:", url.pathname);
});

export {};
