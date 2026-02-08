/**
 * DatabaseManager - Manages SQLite database lifecycle for the service worker
 *
 * Handles:
 * - Database initialization with sql.js
 * - User switching with race condition prevention
 * - Persistence to IndexedDB
 * - Schema creation
 */

import initSqlJs from "sql.js";
import type { Database, ServiceWorkerContext } from "./types";
import {
  loadFromIndexedDB,
  saveToIndexedDB,
  setCurrentUserId,
} from "./persistence";

// Schema SQL for creating tables
const SCHEMA_SQL = `
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
  CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    ai_config TEXT,
    theme TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '⏰ Time to write your TIL!',
    time TEXT NOT NULL,
    days TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    enabled INTEGER DEFAULT 1,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

export class DatabaseManager {
  private sqliteDb: Database | null = null;
  private sqliteDbUserId: string | null | undefined = undefined;
  private switchVersion: number = 0;
  private currentUserId: string | null = null;
  private cacheName: string;

  constructor(
    private ctx: ServiceWorkerContext,
    cacheName: string = "til-stack-v2"
  ) {
    this.cacheName = cacheName;
  }

  /**
   * Get the current database instance (may be null if not initialized)
   */
  getDatabase(): Database | null {
    return this.sqliteDb;
  }

  /**
   * Get the user ID the current database belongs to
   */
  getUserId(): string | null | undefined {
    return this.sqliteDbUserId;
  }

  /**
   * Get the current switch version (for race condition detection)
   */
  getSwitchVersion(): number {
    return this.switchVersion;
  }

  /**
   * Get the current user ID
   */
  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  /**
   * Ensure database is initialized for the given user
   * If userId is provided and differs from current, will switch users
   */
  async ensureInitialized(userId?: string | null): Promise<Database> {
    // If specific userId provided and differs, switch first
    if (userId !== undefined && userId !== this.currentUserId) {
      await this.switchToUser(userId);
    }
    return this.initDatabase();
  }

  /**
   * Initialize database (or return existing if valid)
   */
  async initDatabase(): Promise<Database> {
    return this.initDatabaseWithVersion(this.switchVersion);
  }

  /**
   * Initialize database with version check to prevent race conditions
   */
  private async initDatabaseWithVersion(expectedVersion: number): Promise<Database> {
    // If database exists, check if it's for the correct user
    if (this.sqliteDb) {
      if (
        this.sqliteDbUserId === this.currentUserId &&
        this.switchVersion === expectedVersion
      ) {
        this.ctx.debug.log(
          "db",
          `Database already initialized for correct user=${this.currentUserId}, version=${expectedVersion}`
        );
        return this.sqliteDb;
      }
      // Database exists but for wrong user - close it and reload
      this.ctx.debug.log(
        "db",
        `Database exists but for wrong user (sqliteDbUserId=${this.sqliteDbUserId}, currentUserId=${this.currentUserId}), closing...`
      );
      this.close();
    }

    // If version changed during our execution, another switchToUser happened
    if (this.switchVersion !== expectedVersion) {
      this.ctx.debug.log(
        "db",
        `Version mismatch (expected=${expectedVersion}, current=${this.switchVersion}), retrying...`
      );
      return this.initDatabaseWithVersion(this.switchVersion);
    }

    this.ctx.debug.log(
      "db",
      `Initializing database for userId=${this.currentUserId}, version=${expectedVersion}...`
    );

    // Try to load wasm from cache first (for offline support)
    let wasmBinary: ArrayBuffer | undefined;
    try {
      const cache = await caches.open(this.cacheName);
      const cachedResponse = await cache.match("/sql.js/sql-wasm.wasm");
      if (cachedResponse) {
        this.ctx.debug.log("db", "Loading wasm from cache");
        wasmBinary = await cachedResponse.arrayBuffer();
      }
    } catch (e) {
      this.ctx.debug.log("db", "Cache miss for wasm, will fetch from network");
    }

    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        this.ctx.debug.log("db", `sql.js locateFile: ${file}`);
        return `/sql.js/${file}`;
      },
      wasmBinary,
    });
    this.ctx.debug.log("db", "sql.js loaded");

    // Check version after wasm load
    if (this.switchVersion !== expectedVersion) {
      this.ctx.debug.log(
        "db",
        `Version changed during wasm init (expected=${expectedVersion}, current=${this.switchVersion}), retrying...`
      );
      return this.initDatabaseWithVersion(this.switchVersion);
    }

    // Load data for current user (null = anonymous)
    const loadKey = this.currentUserId;
    this.ctx.debug.log(
      "db",
      `About to load from IndexedDB for loadKey=${loadKey}, currentUserId=${this.currentUserId}, version=${expectedVersion}`
    );
    const savedData = await loadFromIndexedDB(loadKey);
    this.ctx.debug.log(
      "db",
      `loadFromIndexedDB returned: ${savedData ? `${savedData.length} bytes` : "null"}, loadKey was=${loadKey}`
    );

    // CRITICAL: Check if version changed during the async load
    if (this.switchVersion !== expectedVersion) {
      this.ctx.debug.log(
        "db",
        `Version changed during load (expected=${expectedVersion}, current=${this.switchVersion}), discarding and retrying...`
      );
      return this.initDatabaseWithVersion(this.switchVersion);
    }

    this.ctx.debug.log(
      "db",
      `IndexedDB data for userId=${this.currentUserId}: ${savedData ? `${savedData.length} bytes` : "none (creating new)"}`
    );

    const wasEmpty = !savedData;

    // IMPORTANT: Make absolutely sure we're creating a fresh database
    if (this.sqliteDb) {
      this.ctx.debug.log(
        "db",
        "WARNING: sqliteDb was not null before creating new database! Closing it."
      );
      this.sqliteDb.close();
      this.sqliteDb = null;
    }

    const db = savedData ? new SQL.Database(savedData) : new SQL.Database();
    this.sqliteDb = db;
    this.sqliteDbUserId = this.currentUserId;
    this.ctx.debug.log(
      "db",
      `Database loaded and associated with userId=${this.currentUserId}, wasEmpty=${wasEmpty}, dataSize=${savedData?.length || 0}`
    );

    // Debug: Check what's in the database after loading
    const entriesCheck = db!.exec(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='entries'`
    );
    if (entriesCheck[0]?.values?.length) {
      const countCheck = db!.exec(`SELECT COUNT(*) FROM entries`);
      const sampleCheck = db!.exec(
        `SELECT date, substr(content, 1, 40) FROM entries LIMIT 3`
      );
      const entryCount = countCheck[0]?.values[0]?.[0] || 0;
      this.ctx.debug.log(
        "db",
        `After load (wasEmpty=${wasEmpty}): ${entryCount} entries, sample: ${JSON.stringify(sampleCheck[0]?.values)}`
      );

      // CRITICAL: If we loaded an empty database but now have entries, something is wrong!
      if (wasEmpty && (entryCount as number) > 0) {
        console.error(
          `[DatabaseManager] DATA INTEGRITY ERROR: Database was empty but now has ${entryCount} entries! This indicates a race condition or data leak.`
        );
      }
    } else {
      this.ctx.debug.log(
        "db",
        `After load (wasEmpty=${wasEmpty}): entries table doesn't exist yet`
      );
    }

    // Create tables if they don't exist
    db!.run(SCHEMA_SQL);

    // Persist after schema changes to ensure new tables are saved to IndexedDB
    // This is important when upgrading existing databases with new tables (e.g., webhooks)
    if (!wasEmpty) {
      // Only persist if we loaded existing data - new DBs will be persisted on first write
      await saveToIndexedDB(db!.export(), loadKey);
      this.ctx.debug.log('db', 'Persisted schema changes for existing database');
    }

    return db!;
  }

  /**
   * Switch to a different user's database
   * Increments version to invalidate any in-flight async operations
   */
  async switchToUser(userId: string | null): Promise<void> {
    this.ctx.debug.log("db", `Switching to user: ${userId || "anonymous"}`);

    // Increment version to invalidate any in-flight async operations for the old user
    this.switchVersion++;
    const myVersion = this.switchVersion;

    // Close current database
    this.close();

    // Update current user
    this.currentUserId = userId;
    setCurrentUserId(userId);

    // Initialize the new database immediately to prevent race conditions
    await this.initDatabaseWithVersion(myVersion);
    this.ctx.debug.log(
      "db",
      `Switched to user: ${userId || "anonymous"}, database initialized, version=${myVersion}`
    );
  }

  /**
   * Persist database to IndexedDB
   * Uses sqliteDbUserId (not currentUserId) to prevent race conditions
   */
  async persist(): Promise<void> {
    if (!this.sqliteDb) {
      return;
    }

    // Capture the user ID this database belongs to BEFORE any async operations
    const dbOwnerUserId = this.sqliteDbUserId;
    const capturedVersion = this.switchVersion;

    // If the database doesn't belong to the current user anymore, don't persist
    if (dbOwnerUserId !== this.currentUserId) {
      this.ctx.debug.log(
        "db",
        `persist: db belongs to user ${dbOwnerUserId} but currentUserId is ${this.currentUserId}, skipping persist`
      );
      return;
    }

    const data = this.sqliteDb.export();

    // Check if version changed during export (another user switch happened)
    if (this.switchVersion !== capturedVersion) {
      this.ctx.debug.log(
        "db",
        `persist: version changed during export (${capturedVersion} -> ${this.switchVersion}), skipping persist`
      );
      return;
    }

    await saveToIndexedDB(data, dbOwnerUserId);
  }

  /**
   * Close and clear current database instance
   */
  close(): void {
    if (this.sqliteDb) {
      this.sqliteDb.close();
      this.sqliteDb = null;
    }
    this.sqliteDbUserId = undefined;
  }
}
