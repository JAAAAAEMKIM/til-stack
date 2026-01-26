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
  getAnonymousData,
  lastLoadKey,
  lastClearResult,
  lastLoadDiagnostic,
  loadDiagnosticHistory,
  saveDiagnosticHistory,
  clearedKeys,
} from "./worker/persistence";

const SW_VERSION = "2026-01-19-v2";
const CACHE_NAME = "til-stack-v1";
const SYNC_TAG = "til-stack-sync";

// Current state
let sqliteDb: Database | null = null;
let sqliteDbUserId: string | null | undefined = undefined; // Track which user the current sqliteDb belongs to
let currentUserId: string | null = null;
let isOnline = true;
let syncInProgress = false;
let userSwitchVersion = 0; // Incremented on each user switch to detect stale async operations
let lastSyncResult: { action: string; pulled?: number; pushed?: number; error?: string; timestamp: string } | null = null;
let lastLoginInfo: { isNewUser?: boolean; migrated?: boolean; syncCalled?: boolean; timestamp: string } | null = null;
let lastDbLoadInfo: { loadKey: string | null; actualStorageKey: string; persistenceLastLoadKey: string | null; loadedBytes: number | null; verifyLoadedBytes: number | null; currentUserId: string | null; version: number; timestamp: string } | null = null;
let lastClearInfo: { clearedKey: string | null; timestamp: string } | null = null;


// Pending operation types
type PendingOperation = {
  id: string;
  type: "upsert" | "delete" | "skip_day" | "template";
  date: string;
  content?: string;
  payload?: string; // JSON payload for config operations
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
  deletedAt?: string | null; // Tombstone for soft delete
}

// Initialize sql.js and load database for current user
async function initDatabase(): Promise<Database> {
  return initDatabaseWithVersion(userSwitchVersion);
}

// Initialize database with version check to prevent race conditions
async function initDatabaseWithVersion(expectedVersion: number): Promise<Database> {
  // If database exists, check if it's for the correct user
  if (sqliteDb) {
    // Verify the database is for the current user
    if (sqliteDbUserId === currentUserId && userSwitchVersion === expectedVersion) {
      console.log(`[SW] Database already initialized for correct user=${currentUserId}, version=${expectedVersion}`);
      return sqliteDb;
    }
    // Database exists but for wrong user - close it and reload
    console.log(`[SW] Database exists but for wrong user (sqliteDbUserId=${sqliteDbUserId}, currentUserId=${currentUserId}), closing...`);
    closeDatabase();
  }

  // If version changed during our execution, another switchToUser happened
  // In that case, recursively call ourselves with the new version
  if (userSwitchVersion !== expectedVersion) {
    console.log(`[SW] Version mismatch (expected=${expectedVersion}, current=${userSwitchVersion}), retrying...`);
    return initDatabaseWithVersion(userSwitchVersion);
  }

  console.log(`[SW] Initializing database for userId=${currentUserId}, version=${expectedVersion}...`);

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

  // Check version after wasm load
  if (userSwitchVersion !== expectedVersion) {
    console.log(`[SW] Version changed during wasm init (expected=${expectedVersion}, current=${userSwitchVersion}), retrying...`);
    return initDatabaseWithVersion(userSwitchVersion);
  }

  // Load data for current user (null = anonymous)
  const loadKey = currentUserId;
  console.log(`[SW] About to load from IndexedDB for loadKey=${loadKey}, currentUserId=${currentUserId}, version=${expectedVersion}`);
  const savedData = await loadFromIndexedDB(loadKey);
  console.log(`[SW] loadFromIndexedDB returned: ${savedData ? `${savedData.length} bytes` : 'null'}, loadKey was=${loadKey}`);

  // CRITICAL: Check if version changed during the async load
  // If it did, another switchToUser happened and we should discard this result
  if (userSwitchVersion !== expectedVersion) {
    console.log(`[SW] Version changed during load (expected=${expectedVersion}, current=${userSwitchVersion}), discarding and retrying...`);
    return initDatabaseWithVersion(userSwitchVersion);
  }

  console.log(`[SW] IndexedDB data for userId=${currentUserId}:`, savedData ? `${savedData.length} bytes` : "none (creating new)");

  const wasEmpty = !savedData;

  // IMPORTANT: Make absolutely sure we're creating a fresh database
  // Double-check that sqliteDb is null before creating new one
  if (sqliteDb) {
    console.log(`[SW] WARNING: sqliteDb was not null before creating new database! Closing it.`);
    sqliteDb.close();
    sqliteDb = null;
  }

  sqliteDb = savedData ? new SQL.Database(savedData) : new SQL.Database();
  sqliteDbUserId = currentUserId; // Track which user this database belongs to
  // Compute the actual storage key that would be used by loadFromIndexedDB
  const actualStorageKey = `sqlite-data-${loadKey || 'anonymous'}`;
  // Do another verify read AFTER creating the database
  const verifyAfter = await loadFromIndexedDB(loadKey);
  lastDbLoadInfo = { loadKey, actualStorageKey, persistenceLastLoadKey: lastLoadKey, loadedBytes: savedData?.length || null, verifyLoadedBytes: verifyAfter?.length || null, currentUserId, version: expectedVersion, timestamp: new Date().toISOString() };
  console.log(`[SW] Database loaded and associated with userId=${currentUserId}, wasEmpty=${wasEmpty}, dataSize=${savedData?.length || 0}`);

  // Debug: Check what's in the database after loading
  const entriesCheck = sqliteDb.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='entries'`);
  if (entriesCheck[0]?.values?.length) {
    const countCheck = sqliteDb.exec(`SELECT COUNT(*) FROM entries`);
    const sampleCheck = sqliteDb.exec(`SELECT date, substr(content, 1, 40) FROM entries LIMIT 3`);
    const entryCount = countCheck[0]?.values[0]?.[0] || 0;
    console.log(`[SW] After load (wasEmpty=${wasEmpty}): ${entryCount} entries, sample:`, sampleCheck[0]?.values);

    // CRITICAL: If we loaded an empty database but now have entries, something is wrong!
    if (wasEmpty && entryCount > 0) {
      console.error(`[SW] DATA INTEGRITY ERROR: Database was empty but now has ${entryCount} entries! This indicates a race condition or data leak.`);
    }
  } else {
    console.log(`[SW] After load (wasEmpty=${wasEmpty}): entries table doesn't exist yet`);
  }

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
      date TEXT,
      content TEXT,
      payload TEXT,
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
  sqliteDbUserId = undefined; // Clear the user association
}

// Persist database to IndexedDB for the user the database belongs to
// IMPORTANT: We use sqliteDbUserId (not currentUserId) to prevent race conditions
// where currentUserId changes during async operations
async function persistDatabase(): Promise<void> {
  if (!sqliteDb) {
    return;
  }

  // Capture the user ID this database belongs to BEFORE any async operations
  const dbOwnerUserId = sqliteDbUserId;
  const capturedVersion = userSwitchVersion;

  // If the database doesn't belong to the current user anymore, don't persist
  // This can happen if switchToUser was called but the database hasn't been reloaded yet
  if (dbOwnerUserId !== currentUserId) {
    console.warn(`[SW] persistDatabase: db belongs to user ${dbOwnerUserId} but currentUserId is ${currentUserId}, skipping persist`);
    return;
  }

  const data = sqliteDb.export();

  // Check if version changed during export (another user switch happened)
  if (userSwitchVersion !== capturedVersion) {
    console.warn(`[SW] persistDatabase: version changed during export (${capturedVersion} -> ${userSwitchVersion}), skipping persist`);
    return;
  }

  await saveToIndexedDB(data, dbOwnerUserId);
}

// Switch to a different user's database
async function switchToUser(userId: string | null): Promise<void> {
  console.log(`[SW] Switching to user: ${userId || "anonymous"}`);

  // Increment version to invalidate any in-flight async operations for the old user
  userSwitchVersion++;
  const myVersion = userSwitchVersion;

  // Close current database
  closeDatabase();

  // Update current user
  currentUserId = userId;
  setCurrentUserId(userId);

  // Initialize the new database immediately to prevent race conditions
  // This ensures any concurrent requests see the correct database
  await initDatabaseWithVersion(myVersion);
  console.log(`[SW] Switched to user: ${userId || "anonymous"}, database initialized, version=${myVersion}`);
}

// ====== PENDING OPERATIONS ======

// Add a pending operation (when offline)
async function addPendingOperation(op: Omit<PendingOperation, "id" | "createdAt">): Promise<void> {
  const db = await initDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Dedupe logic to prevent duplicate pending operations
  if (op.type === "upsert" || op.type === "delete") {
    // Entry operations: dedupe by date
    db.run(`DELETE FROM sync_pending WHERE date = ?`, [op.date]);
  } else if (op.type === "skip_day" && op.payload) {
    // Skip day operations: dedupe by (action, type, value)
    const payload = JSON.parse(op.payload);
    const existing = db.exec(
      `SELECT id, payload FROM sync_pending WHERE type = 'skip_day'`
    );
    if (existing[0]?.values) {
      for (const [existingId, existingPayload] of existing[0].values) {
        try {
          const p = JSON.parse(existingPayload as string);
          if (p.action === payload.action && p.type === payload.type && p.value === payload.value) {
            db.run(`DELETE FROM sync_pending WHERE id = ?`, [existingId]);
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }
  } else if (op.type === "template" && op.payload) {
    // Template operations: dedupe by (action, id) for updates/deletes, (action, name) for creates
    const payload = JSON.parse(op.payload);
    const existing = db.exec(
      `SELECT id, payload FROM sync_pending WHERE type = 'template'`
    );
    if (existing[0]?.values) {
      for (const [existingId, existingPayload] of existing[0].values) {
        try {
          const p = JSON.parse(existingPayload as string);
          const shouldDelete =
            (payload.action === "create" && p.action === "create" && p.name === payload.name) ||
            (payload.action !== "create" && p.action === payload.action && p.id === payload.id);
          if (shouldDelete) {
            db.run(`DELETE FROM sync_pending WHERE id = ?`, [existingId]);
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }
  }

  db.run(
    `INSERT INTO sync_pending (id, type, date, content, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, op.type, op.date ?? null, op.content ?? null, op.payload ?? null, now]
  );
  await persistDatabase();
  console.log(`[SW] Added pending ${op.type}${op.date ? ` for date ${op.date}` : ""}`);
}

// Get all pending operations
async function getPendingOperations(): Promise<PendingOperation[]> {
  const db = await initDatabase();
  const results = db.exec(`SELECT * FROM sync_pending ORDER BY created_at ASC`);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    type: row[1] as PendingOperation["type"],
    date: row[2] as string,
    content: row[3] as string | undefined,
    payload: row[4] as string | undefined,
    createdAt: row[5] as string,
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
            body: JSON.stringify({ date: op.date }),
          });
          console.log(`[SW] Synced delete for ${op.date}`);
        } else if (op.type === "skip_day" && op.payload) {
          const payload = JSON.parse(op.payload);
          await pushSkipDayToServer(payload);
          console.log(`[SW] Synced skip_day: ${payload.action}`);
        } else if (op.type === "template" && op.payload) {
          const payload = JSON.parse(op.payload);
          await pushTemplateToServer(payload);
          console.log(`[SW] Synced template: ${payload.action}`);
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

// Fetch ALL entries from server using cursor-based pagination
// This handles users with more than 1000 entries by fetching in batches
async function fetchServerEntries(): Promise<SyncEntry[]> {
  const allEntries: SyncEntry[] = [];
  let cursor: string | undefined;
  const PAGE_SIZE = 50; // Server limit is 50 max

  try {
    do {
      // Include deleted entries (tombstones) for sync to handle deletions across devices
      // Note: Use direct format (not batch {"0": ...}) for pagination to work correctly
      const input = { limit: PAGE_SIZE, includeDeleted: true, cursor };
      const response = await fetch(
        `${API_URL}/trpc/entries.list?input=${encodeURIComponent(JSON.stringify(input))}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const { items, nextCursor } = data.result?.data || { items: [], nextCursor: undefined };

      const entries = items.map((item: Record<string, unknown>) => ({
        id: item.id as string,
        date: item.date as string,
        content: item.content as string,
        userId: (item.userId as string) ?? null,
        createdAt: item.createdAt as string,
        updatedAt: item.updatedAt as string,
        deletedAt: (item.deletedAt as string) ?? null,
      }));

      allEntries.push(...entries);
      cursor = nextCursor;

      console.log(`[SW] Fetched ${entries.length} entries, total: ${allEntries.length}, hasMore: ${!!cursor}`);
    } while (cursor);

    return allEntries;
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
    body: JSON.stringify(entry),
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

// ====== CONFIG SYNC FUNCTIONS ======

// Skip day type for sync
interface SyncSkipDay {
  id: string;
  type: "weekday" | "specific_date";
  value: string;
  userId: string | null;
  createdAt: string;
}

// Template type for sync
interface SyncTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Push skip day to server
async function pushSkipDayToServer(skipDay: { action: "add" | "remove"; type: "weekday" | "specific_date"; value: string; id?: string }): Promise<void> {
  if (skipDay.action === "add") {
    const procedure = skipDay.type === "weekday" ? "config.addSkipWeekday" : "config.addSkipDate";
    const input = skipDay.type === "weekday"
      ? { weekday: parseInt(skipDay.value) }
      : { date: skipDay.value };

    const response = await fetch(`${API_URL}/trpc/${procedure}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  } else if (skipDay.action === "remove" && skipDay.id) {
    const response = await fetch(`${API_URL}/trpc/config.removeSkipDay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: skipDay.id }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  }
  console.log(`[SW] Pushed skip day to server: ${skipDay.action} ${skipDay.type}=${skipDay.value}`);
}

// Push template to server
async function pushTemplateToServer(template: { action: "create" | "update" | "delete" | "setDefault"; id?: string | null; name?: string; content?: string }): Promise<void> {
  let procedure: string;
  let input: Record<string, unknown>;

  switch (template.action) {
    case "create":
      procedure = "config.createTemplate";
      input = { name: template.name, content: template.content };
      break;
    case "update":
      procedure = "config.updateTemplate";
      input = { id: template.id, name: template.name, content: template.content };
      break;
    case "delete":
      procedure = "config.deleteTemplate";
      input = { id: template.id };
      break;
    case "setDefault":
      procedure = "config.setDefaultTemplate";
      input = { id: template.id ?? null };
      break;
    default:
      throw new Error(`Unknown template action: ${template.action}`);
  }

  const response = await fetch(`${API_URL}/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }
  console.log(`[SW] Pushed template to server: ${template.action} ${template.id || template.name}`);
}

// Fetch skip days from server
async function fetchServerSkipDays(): Promise<SyncSkipDay[]> {
  try {
    const response = await fetch(`${API_URL}/trpc/config.getSkipDays`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const result = data.result?.data;

    // Server returns { weekdays: number[], specificDates: string[], raw: [] }
    const raw = result?.raw || [];
    return raw.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      type: item.type as "weekday" | "specific_date",
      value: item.value as string,
      userId: (item.userId as string) ?? null,
      createdAt: item.createdAt as string,
    }));
  } catch (error) {
    console.error("[SW] Failed to fetch server skip days:", error);
    throw error;
  }
}

// Fetch templates from server
async function fetchServerTemplates(): Promise<SyncTemplate[]> {
  try {
    const response = await fetch(`${API_URL}/trpc/config.getTemplates`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const items = data.result?.data || [];

    return items.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      name: item.name as string,
      content: item.content as string,
      isDefault: Boolean(item.isDefault),
      userId: (item.userId as string) ?? null,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    }));
  } catch (error) {
    console.error("[SW] Failed to fetch server templates:", error);
    throw error;
  }
}

// Update local skip days from server data
function updateLocalSkipDays(db: Database, serverSkipDays: SyncSkipDay[]): void {
  // Get current local skip days
  const localResults = db.exec(`SELECT id, type, value FROM skip_days`);
  const localMap = new Map<string, { id: string; type: string; value: string }>();
  if (localResults[0]?.values) {
    for (const row of localResults[0].values) {
      const key = `${row[1]}-${row[2]}`;
      localMap.set(key, { id: row[0] as string, type: row[1] as string, value: row[2] as string });
    }
  }

  // Server skip days (server is source of truth)
  const serverMap = new Map<string, SyncSkipDay>();
  for (const skipDay of serverSkipDays) {
    const key = `${skipDay.type}-${skipDay.value}`;
    serverMap.set(key, skipDay);
  }

  // Add/update from server
  for (const [key, skipDay] of serverMap) {
    const local = localMap.get(key);
    if (!local) {
      // Insert new skip day
      db.run(
        `INSERT INTO skip_days (id, type, value, user_id, created_at) VALUES (?, ?, ?, ?, ?)`,
        [skipDay.id, skipDay.type, skipDay.value, skipDay.userId, skipDay.createdAt]
      );
    }
  }

  // Remove local skip days not on server
  for (const [key, local] of localMap) {
    if (!serverMap.has(key)) {
      db.run(`DELETE FROM skip_days WHERE id = ?`, [local.id]);
    }
  }
}

// Update local templates from server data
function updateLocalTemplates(db: Database, serverTemplates: SyncTemplate[]): void {
  // Get current local templates
  const localResults = db.exec(`SELECT id, updated_at FROM templates`);
  const localMap = new Map<string, string>();
  if (localResults[0]?.values) {
    for (const row of localResults[0].values) {
      localMap.set(row[0] as string, row[1] as string);
    }
  }

  const serverIds = new Set<string>();

  // Add/update from server (last-write-wins)
  for (const template of serverTemplates) {
    serverIds.add(template.id);
    const localUpdatedAt = localMap.get(template.id);

    if (!localUpdatedAt) {
      // Insert new template
      db.run(
        `INSERT INTO templates (id, name, content, is_default, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [template.id, template.name, template.content, template.isDefault ? 1 : 0, template.userId, template.createdAt, template.updatedAt]
      );
    } else if (new Date(template.updatedAt) >= new Date(localUpdatedAt)) {
      // Update existing template (server wins on tie)
      db.run(
        `UPDATE templates SET name = ?, content = ?, is_default = ?, updated_at = ? WHERE id = ?`,
        [template.name, template.content, template.isDefault ? 1 : 0, template.updatedAt, template.id]
      );
    }
  }

  // Remove local templates not on server (deleted on server)
  // But protect templates that have pending create operations (not yet synced)
  const pendingResults = db.exec(`SELECT payload FROM sync_pending WHERE type = 'template'`);
  const pendingTemplateNames = new Set<string>();
  if (pendingResults[0]?.values) {
    for (const [payload] of pendingResults[0].values) {
      try {
        const p = JSON.parse(payload as string);
        if (p.action === "create" && p.name) {
          pendingTemplateNames.add(p.name);
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  for (const [localId] of localMap) {
    if (!serverIds.has(localId)) {
      // Check if this template has a pending create operation (by name match)
      const templateResult = db.exec(`SELECT name FROM templates WHERE id = ?`, [localId]);
      const templateName = templateResult[0]?.values[0]?.[0] as string | undefined;
      if (templateName && pendingTemplateNames.has(templateName)) {
        console.log(`[SW] Protecting pending template from deletion: ${templateName}`);
        continue; // Don't delete - it has a pending sync
      }
      db.run(`DELETE FROM templates WHERE id = ?`, [localId]);
    }
  }
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

// Update local entry from server data (handles tombstones for deletion sync)
function updateLocalEntry(db: Database, entry: SyncEntry): void {
  const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [entry.date]);

  // If entry is deleted on server, delete locally
  if (entry.deletedAt) {
    if (existing[0]?.values[0]) {
      db.run(`DELETE FROM entries WHERE date = ?`, [entry.date]);
      console.log(`[SW] Deleted local entry for ${entry.date} (tombstone from server)`);
    }
    return;
  }

  // Normal upsert for non-deleted entries
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

  console.log(`[SW] Pulling from server... currentUserId=${currentUserId}`);
  const db = await initDatabase();

  // Debug: Check what's in the database BEFORE pull
  const beforeCount = db.exec(`SELECT COUNT(*) FROM entries`)[0]?.values[0]?.[0] || 0;
  const beforeEntries = db.exec(`SELECT date, substr(content, 1, 40) FROM entries LIMIT 3`);
  console.log(`[SW] Before pull: ${beforeCount} entries, sample:`, beforeEntries[0]?.values);

  try {
    // Pull entries (including tombstones for deletion sync)
    const serverEntries = await fetchServerEntries();
    const activeEntries = serverEntries.filter(e => !e.deletedAt);
    const deletedEntries = serverEntries.filter(e => e.deletedAt);
    console.log(`[SW] Got ${serverEntries.length} entries from server (${activeEntries.length} active, ${deletedEntries.length} deleted)`);
    // Debug: Log first few entries from server
    console.log(`[SW] Server entries sample:`, serverEntries.slice(0, 3).map(e => ({ date: e.date, content: e.content?.substring(0, 40) })));

    for (const entry of serverEntries) {
      updateLocalEntry(db, entry);
    }

    // Pull config data (skip days and templates)
    try {
      const serverSkipDays = await fetchServerSkipDays();
      console.log(`[SW] Got ${serverSkipDays.length} skip days from server`);
      updateLocalSkipDays(db, serverSkipDays);
    } catch (error) {
      console.warn("[SW] Failed to pull skip days:", error);
    }

    try {
      const serverTemplates = await fetchServerTemplates();
      console.log(`[SW] Got ${serverTemplates.length} templates from server`);
      updateLocalTemplates(db, serverTemplates);
    } catch (error) {
      console.warn("[SW] Failed to pull templates:", error);
    }

    await persistDatabase();
    console.log(`[SW] Pull complete: ${activeEntries.length} active entries, ${deletedEntries.length} deleted`);
    lastSyncResult = { action: 'pull', pulled: activeEntries.length, timestamp: new Date().toISOString() };
    return activeEntries.length;
  } catch (error) {
    console.error("[SW] Pull failed:", error);
    lastSyncResult = { action: 'pull', error: String(error), timestamp: new Date().toISOString() };
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
    // Push entries
    const localEntries = getLocalEntries(db);
    console.log(`[SW] Pushing ${localEntries.length} local entries`);

    let pushed = 0;
    for (const entry of localEntries) {
      await pushEntryToServer({ date: entry.date, content: entry.content });
      pushed++;
    }

    // Note: Skip days and templates are pushed during individual mutations.
    // During fullSync (new user), we push local config data.
    // The server APIs are idempotent (return existing if duplicate),
    // so duplicate pushes are safe but may cause ID divergence.
    // After pushing, we immediately pull to reconcile IDs.

    // Push skip days (server is idempotent - returns existing if duplicate)
    try {
      const skipDaysResults = db.exec(`SELECT type, value FROM skip_days`);
      const skipDays = skipDaysResults[0]?.values || [];
      console.log(`[SW] Pushing ${skipDays.length} skip days`);
      for (const [type, value] of skipDays) {
        await pushSkipDayToServer({
          action: "add",
          type: type as "weekday" | "specific_date",
          value: value as string,
        });
      }
    } catch (error) {
      console.warn("[SW] Failed to push skip days:", error);
    }

    // Push templates (server creates new, so only push if they don't exist on server yet)
    // NOTE: This can cause duplicates if local templates already exist on server with different IDs.
    // The pull after push will reconcile by downloading server state.
    try {
      const templatesResults = db.exec(`SELECT id, name, content FROM templates`);
      const templates = templatesResults[0]?.values || [];
      console.log(`[SW] Pushing ${templates.length} templates`);
      for (const [, name, content] of templates) {
        await pushTemplateToServer({
          action: "create",
          name: name as string,
          content: content as string,
        });
      }
    } catch (error) {
      console.warn("[SW] Failed to push templates:", error);
    }

    console.log(`[SW] Push complete: ${pushed} entries`);
    return pushed;
  } catch (error) {
    console.error("[SW] Push failed:", error);
    throw error;
  }
}

/// Full sync: pull from server, then process pending ops
///
/// Sync strategy (Last-Push-Wins):
/// 1. Pull from server first to get latest state
/// 2. Process pending operations (offline edits) - these push to server
/// 3. Pull again to reconcile any conflicts (server's version wins for same timestamp)
///
/// Note: We don't push all local entries. Entries are pushed when created (online)
/// or via pending operations (offline). This prevents overwriting server changes.
async function fullSync(): Promise<{ pushed: number; pulled: number; pendingSynced: number }> {
  if (syncInProgress) {
    console.log("[SW] Sync already in progress");
    return { pushed: 0, pulled: 0, pendingSynced: 0 };
  }

  syncInProgress = true;
  console.log("[SW] Starting full sync...");

  try {
    // 1. Pull from server first to get latest state
    const pulled = await pullFromServer();

    // 2. Process pending operations from offline period
    // These are explicit local changes that need to be pushed
    const pendingResult = await processPendingOperationsInternal();
    const pendingSynced = pendingResult.synced;

    // 3. If we pushed any pending ops, pull again to reconcile
    if (pendingSynced > 0) {
      await pullFromServer();
    }

    console.log(`[SW] Full sync complete: pendingSynced=${pendingSynced}, pushed=${pendingSynced}, pulled=${pulled}`);
    lastSyncResult = { action: 'fullSync', pushed: pendingSynced, pulled, timestamp: new Date().toISOString() };
    return { pushed: pendingSynced, pulled, pendingSynced };
  } catch (error) {
    console.error("[SW] Full sync failed:", error);
    lastSyncResult = { action: 'fullSync', error: String(error), timestamp: new Date().toISOString() };
    throw error;
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
          body: JSON.stringify({ date: op.date }),
        });
      } else if (op.type === "skip_day" && op.payload) {
        const payload = JSON.parse(op.payload);
        await pushSkipDayToServer(payload);
      } else if (op.type === "template" && op.payload) {
        const payload = JSON.parse(op.payload);
        await pushTemplateToServer(payload);
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
// IMPORTANT: mergeAnonymous defaults to false for safety - only merge when explicitly requested
// This prevents the legacy USER_LOGGED_IN message from accidentally merging anonymous data
async function handleUserLogin(userId: string, isNewUser: boolean, mergeAnonymous: boolean = false): Promise<{ migrated: boolean; merged: boolean; pulled: number; mergedEntries: number }> {
  console.log(`[SW] User login: ${userId}, isNewUser: ${isNewUser}, mergeAnonymous: ${mergeAnonymous}`);

  // Skip duplicate login handling if already logged in as this user
  // This prevents the legacy USER_LOGGED_IN message (from useEffect) from triggering
  // a second login process after the proper USER_LOGIN was already handled
  if (currentUserId === userId && sqliteDb && sqliteDbUserId === userId) {
    console.log(`[SW] Already logged in as ${userId}, skipping duplicate login handling`);
    return { migrated: false, merged: false, pulled: 0, mergedEntries: 0 };
  }

  let migrated = false;
  let merged = false;
  let mergedEntries = 0;

  if (isNewUser) {
    // New user: migrate anonymous data to their namespace, then push to server
    console.log("[SW] New user - migrating anonymous data");
    migrated = await migrateAnonymousToUser(userId);
    console.log(`[SW] Migration result: migrated=${migrated}`);

    // Switch to user's database
    await switchToUser(userId);
    console.log(`[SW] Switched to user database, isOnline=${isOnline}`);

    // Push migrated data to server, then pull merged result
    const syncCalled = migrated && isOnline;
    lastLoginInfo = { isNewUser: true, migrated, syncCalled, timestamp: new Date().toISOString() };

    if (syncCalled) {
      console.log("[SW] Calling fullSync for new user...");
      try {
        const syncResult = await fullSync();
        console.log(`[SW] fullSync completed: pushed=${syncResult.pushed}, pulled=${syncResult.pulled}`);
      } catch (error) {
        console.warn("[SW] Initial sync failed:", error);
        lastSyncResult = { action: 'fullSync', error: String(error), timestamp: new Date().toISOString() };
      }
    } else {
      console.log(`[SW] Skipping fullSync: migrated=${migrated}, isOnline=${isOnline}`);
    }
  } else {
    // Existing user (possibly on new device): check for anonymous data to merge first
    console.log("[SW] Existing user - checking for anonymous data to merge");

    // Check if there's anonymous data to merge BEFORE switching users
    if (mergeAnonymous) {
      const anonymousData = await getAnonymousData();
      if (anonymousData && anonymousData.length > 0) {
        console.log(`[SW] Found anonymous data to merge: ${anonymousData.length} bytes`);

        // Load the anonymous database to extract entries
        const SQL = await initSqlJs({
          locateFile: (file: string) => `/sql.js/${file}`,
        });
        const anonymousDb = new SQL.Database(anonymousData);

        // Extract entries from anonymous DB
        const anonymousEntriesResult = anonymousDb.exec(`SELECT date, content, updated_at FROM entries`);
        const anonymousEntries = anonymousEntriesResult[0]?.values.map((row: unknown[]) => ({
          date: row[0] as string,
          content: row[1] as string,
          updatedAt: row[2] as string,
        })) || [];

        console.log(`[SW] Found ${anonymousEntries.length} anonymous entries to merge`);
        anonymousDb.close();

        if (anonymousEntries.length > 0) {
          // Switch to user's database
          await switchToUser(userId);

          // Pull from server first to get current state
          if (isOnline) {
            try {
              await pullFromServer();
            } catch (error) {
              console.warn("[SW] Pull before merge failed:", error);
            }
          }

          // Merge anonymous entries (last-write-wins)
          const db = await initDatabase();
          for (const entry of anonymousEntries) {
            const existing = db.exec(`SELECT updated_at FROM entries WHERE date = ?`, [entry.date]);
            const localUpdatedAt = existing[0]?.values[0]?.[0] as string | undefined;

            // If no local entry or anonymous is newer, upsert
            if (!localUpdatedAt || new Date(entry.updatedAt) > new Date(localUpdatedAt)) {
              const now = new Date().toISOString();
              const existingEntry = db.exec(`SELECT id FROM entries WHERE date = ?`, [entry.date]);
              if (existingEntry[0]?.values[0]) {
                db.run(`UPDATE entries SET content = ?, updated_at = ? WHERE date = ?`, [
                  entry.content,
                  entry.updatedAt,
                  entry.date,
                ]);
              } else {
                const id = crypto.randomUUID();
                db.run(
                  `INSERT INTO entries (id, date, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
                  [id, entry.date, entry.content, now, entry.updatedAt]
                );
              }
              mergedEntries++;
              console.log(`[SW] Merged anonymous entry for ${entry.date}`);

              // Queue for sync to server if online
              if (currentUserId && isOnline) {
                pushEntryToServer({ date: entry.date, content: entry.content }).catch((err) => {
                  console.warn(`[SW] Failed to push merged entry ${entry.date}:`, err);
                  addPendingOperation({ type: "upsert", date: entry.date, content: entry.content });
                });
              } else if (currentUserId) {
                await addPendingOperation({ type: "upsert", date: entry.date, content: entry.content });
              }
            }
          }

          await persistDatabase();

          // Clear anonymous data after successful merge
          await clearUserDatabase(null);
          console.log(`[SW] Cleared anonymous data after merge`);

          merged = true;
          return { migrated: false, merged: true, pulled: 0, mergedEntries };
        }
      }
    }

    // No anonymous data or mergeAnonymous=false: just pull from server
    console.log("[SW] Existing user - pulling from server");
    lastLoginInfo = { isNewUser: false, migrated: false, syncCalled: false, timestamp: new Date().toISOString() };

    // Switch to user's database
    await switchToUser(userId);

    // Pull server data (don't push - we might have empty local DB)
    if (isOnline) {
      try {
        const pulled = await pullFromServer();
        return { migrated: false, merged: false, pulled, mergedEntries: 0 };
      } catch (error) {
        console.warn("[SW] Pull failed:", error);
      }
    }
  }

  return { migrated, merged, pulled: 0, mergedEntries };
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
  console.log(`[SW] handleLocalRequest: procedure=${procedure}, currentUserId=${currentUserId}, sqliteDb=${sqliteDb ? 'exists' : 'null'}, sqliteDbUserId=${sqliteDbUserId}`);

  // CRITICAL: Verify database is for correct user before proceeding
  if (sqliteDb && sqliteDbUserId !== currentUserId) {
    console.warn(`[SW] handleLocalRequest: Database mismatch! sqliteDbUserId=${sqliteDbUserId}, currentUserId=${currentUserId}. Reinitializing...`);
    closeDatabase();
  }

  const db = await initDatabase();

  // Debug: Check what entries are in the database
  if (procedure === 'entries.getByDate' || procedure === 'entries.list') {
    const countResult = db.exec(`SELECT COUNT(*) FROM entries`);
    const count = countResult[0]?.values[0]?.[0] || 0;
    const sampleResult = db.exec(`SELECT date, substr(content, 1, 30) as content FROM entries LIMIT 3`);
    console.log(`[SW] DEBUG: entries count=${count}, sample:`, sampleResult[0]?.values, `dbUserId=${sqliteDbUserId}`);
  }
  console.log(`[SW] handleLocalRequest: database initialized for userId=${currentUserId}, sqliteDbUserId=${sqliteDbUserId}`);

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
            body: JSON.stringify({ date }),
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

      // Sync to server if logged in
      if (currentUserId) {
        const payload = { action: "add" as const, type: "weekday" as const, value: weekday.toString() };
        if (isOnline) {
          pushSkipDayToServer(payload).catch((err) => {
            console.warn("[SW] Background skip day push failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "skip_day", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "skip_day", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

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

      // Sync to server if logged in
      if (currentUserId) {
        const payload = { action: "add" as const, type: "specific_date" as const, value: date };
        if (isOnline) {
          pushSkipDayToServer(payload).catch((err) => {
            console.warn("[SW] Background skip date push failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "skip_day", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "skip_day", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

      return { id, type: "specific_date", value: date, createdAt: now };
    }
    case "removeSkipDay": {
      const { id } = input as { id: string };
      // Get skip day info before deletion for sync
      const skipDayInfo = db.exec(`SELECT type, value FROM skip_days WHERE id = ?`, [id]);
      const skipDayType = skipDayInfo[0]?.values[0]?.[0] as string | undefined;
      const skipDayValue = skipDayInfo[0]?.values[0]?.[1] as string | undefined;

      db.run(`DELETE FROM skip_days WHERE id = ?`, [id]);
      await persistDatabase();

      // Sync to server if logged in
      if (currentUserId && skipDayType && skipDayValue) {
        const payload = { action: "remove" as const, type: skipDayType as "weekday" | "specific_date", value: skipDayValue, id };
        if (isOnline) {
          pushSkipDayToServer(payload).catch((err) => {
            console.warn("[SW] Background skip day remove failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "skip_day", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "skip_day", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

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

      // Sync to server if logged in
      if (currentUserId) {
        const payload = { action: "create" as const, name, content };
        if (isOnline) {
          pushTemplateToServer(payload).catch((err) => {
            console.warn("[SW] Background template create failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

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

      // Sync to server if logged in
      if (currentUserId) {
        const payload = { action: "update" as const, id, name, content };
        if (isOnline) {
          pushTemplateToServer(payload).catch((err) => {
            console.warn("[SW] Background template update failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

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

      // Sync to server if logged in
      if (currentUserId) {
        const payload = { action: "delete" as const, id };
        if (isOnline) {
          pushTemplateToServer(payload).catch((err) => {
            console.warn("[SW] Background template delete failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

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

      // Sync to server if logged in
      if (currentUserId) {
        const payload = { action: "setDefault" as const, id };
        if (isOnline) {
          pushTemplateToServer(payload).catch((err) => {
            console.warn("[SW] Background template setDefault failed:", err);
            updateOnlineStatus(false);
            addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
            registerBackgroundSync();
          });
        } else {
          await addPendingOperation({ type: "template", date: "", payload: JSON.stringify(payload) });
          await registerBackgroundSync();
        }
      }

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
    // Default to NOT merging for safety - only merge if explicitly requested
    const { userId, isNewUser, mergeAnonymous = false } = event.data;
    console.log(`[SW] USER_LOGIN: userId=${userId}, isNewUser=${isNewUser}, mergeAnonymous=${mergeAnonymous}`);

    try {
      const result = await handleUserLogin(userId, isNewUser, mergeAnonymous);
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
    event.ports[0]?.postMessage({ success: true });
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
      const keyToClear = currentUserId;
      await clearUserDatabase(keyToClear);
      lastClearInfo = { clearedKey: keyToClear, timestamp: new Date().toISOString() };
      closeDatabase();
      event.ports[0]?.postMessage({ success: true });
      console.log("[SW] Local data cleared for key:", keyToClear);
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
  } else if (type === "DEBUG_STATE") {
    // Debug: Return current service worker state (read-only, no modifications)
    try {
      let entryCount = 0;
      let sampleEntries: unknown[][] = [];

      if (sqliteDb) {
        try {
          const countResult = sqliteDb.exec(`SELECT COUNT(*) FROM entries`);
          entryCount = (countResult[0]?.values[0]?.[0] as number) || 0;
          const entriesResult = sqliteDb.exec(`SELECT date, substr(content, 1, 40) as content FROM entries ORDER BY date DESC LIMIT 5`);
          sampleEntries = entriesResult[0]?.values || [];
        } catch {
          // Tables might not exist yet
        }
      }

      event.ports[0]?.postMessage({
        currentUserId,
        sqliteDbUserId: sqliteDbUserId,  // Track which user the in-memory database belongs to
        sqliteDbExists: !!sqliteDb,
        userSwitchVersion,  // Current switch version
        isOnline,
        syncInProgress,
        entryCount,
        sampleEntries,
        lastSyncResult,  // Last sync result for debugging
        lastLoginInfo,  // Last login info for debugging
        lastDbLoadInfo,  // Last database load info for debugging
        lastClearInfo,  // Last clear info for debugging
        persistenceClearResult: lastClearResult,  // Detailed clear result from persistence.ts
        persistenceLoadDiagnostic: lastLoadDiagnostic,  // Load diagnostic with allKeysAtLoad
        loadDiagnosticHistory,  // History of last 10 loads with timestamps
        saveDiagnosticHistory,  // History of last 20 saves with timestamps and stack traces
        clearedKeys: Array.from(clearedKeys),  // Keys that have been cleared
        swVersion: SW_VERSION,
        note: "Read-only state check",
      });
    } catch (error) {
      event.ports[0]?.postMessage({ error: String(error), currentUserId });
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
