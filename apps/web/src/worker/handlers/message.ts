/**
 * MessageHandler - Handles service worker message events
 *
 * Processes all incoming messages from the client and delegates to appropriate modules.
 * Supports login/logout, sync, data export/import, and debug operations.
 */

import type { ServiceWorkerContext, ServiceWorkerMessage } from '../types';
import type { SessionManager } from '../session';
import type { SyncOrchestrator } from '../sync/orchestrator';
import type { DatabaseManager } from '../database';
import * as entriesCrud from '../crud/entries';
import * as configCrud from '../crud/config';
import * as pendingCrud from '../crud/pending';
import { clearUserDatabase, resetClearedKeys, migrateAnonymousToUser } from '../persistence';

export class MessageHandler {
  constructor(
    private ctx: ServiceWorkerContext,
    private sessionManager: SessionManager,
    private syncOrchestrator: SyncOrchestrator,
    private dbManager: DatabaseManager
  ) {}

  async handleMessage(event: ExtendableMessageEvent): Promise<void> {
    const { data, ports } = event;
    const port = ports[0];

    if (!data || typeof data !== 'object') {
      port?.postMessage({ error: 'Invalid message format' });
      return;
    }

    const message = data as ServiceWorkerMessage;
    this.ctx.debug.log('message', `Received: ${message.type}`);

    try {
      const result = await this.processControlMessage(message);
      port?.postMessage(result ?? { success: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.ctx.debug.log('message', `Error handling ${message.type}:`, error);
      port?.postMessage({ error });
    }
  }

  /**
   * Process a control message from either service worker or shared worker.
   * Made public to allow PortHandler to route messages.
   */
  public async processControlMessage(message: ServiceWorkerMessage): Promise<unknown> {
    switch (message.type) {
      case 'USER_LOGIN':
        return this.handleUserLogin(message.userId, message.isNewUser, message.mergeAnonymous);

      case 'USER_LOGGED_IN':
        return this.handleUserLoggedIn(message.userId);

      case 'USER_LOGGED_OUT':
        return this.handleUserLogout();

      case 'USER_ANONYMOUS':
        return this.handleUserAnonymous();

      case 'SYNC_NOW':
        return this.handleSyncNow();

      case 'RETRY_SYNC':
        return this.handleRetrySync();

      case 'SET_ONLINE_STATUS':
        return this.handleSetOnlineStatus(message.online);

      case 'CLEAR_LOCAL_DATA':
        return this.handleClearLocalData();

      case 'UPDATE_ENTRY':
        return this.handleUpdateEntry(message.entry);

      case 'EXPORT_DATA':
        return this.handleExportData();

      case 'CHECK_USER_DATA':
        return this.handleCheckUserData(message.userId);

      case 'DEBUG_STATE':
        return this.handleDebugState();

      case 'CHECK_PENDING_SYNC':
        return this.handleCheckPendingSync();

      default:
        throw new Error(`Unknown message type: ${(message as { type: string }).type}`);
    }
  }

  // ====== Message Handlers ======

  /**
   * Handle USER_LOGIN message (new login with migration options)
   */
  private async handleUserLogin(
    userId: string,
    isNewUser: boolean,
    mergeAnonymous?: boolean
  ): Promise<unknown> {
    this.ctx.debug.log(
      'message',
      `USER_LOGIN: userId=${userId}, isNewUser=${isNewUser}, mergeAnonymous=${mergeAnonymous}`
    );

    // Reset cleared keys tracking to avoid false positive warnings after re-login
    resetClearedKeys();

    // Migrate anonymous data to user namespace if this is a new user who wants to merge
    // This MUST happen BEFORE sessionManager.transition() which triggers switchToUser()
    let migrated = false;
    if (isNewUser && mergeAnonymous) {
      this.ctx.debug.log('message', `Migrating anonymous data to user: ${userId}`);
      migrated = await migrateAnonymousToUser(userId);
      this.ctx.debug.log('message', `Migration result: ${migrated}`);
    }

    await this.sessionManager.transition({
      type: 'LOGIN_STARTED',
      userId,
      isNewUser,
      mergeAnonymous: mergeAnonymous ?? false,
    });

    const result = await this.syncOrchestrator.handleLogin({
      type: 'LOGIN_STARTED',
      userId,
      isNewUser,
      mergeAnonymous: mergeAnonymous ?? false,
    });

    await this.sessionManager.transition({ type: 'LOGIN_COMPLETED', userId });

    // Return result but override migrated with our actual migration result
    return { success: true, ...result, migrated };
  }

  /**
   * Handle USER_LOGGED_IN message (existing session on page load)
   */
  private async handleUserLoggedIn(userId: string): Promise<unknown> {
    this.ctx.debug.log('message', `USER_LOGGED_IN: userId=${userId}`);

    if (!userId) {
      this.ctx.debug.log('message', 'USER_LOGGED_IN with no userId, ignoring');
      return { success: true, skipped: true };
    }

    // Reset cleared keys tracking to avoid false positive warnings after re-login
    resetClearedKeys();

    await this.sessionManager.transition({
      type: 'LOGIN_STARTED',
      userId,
      isNewUser: false,
    });

    const result = await this.syncOrchestrator.handleLogin({
      type: 'LOGIN_STARTED',
      userId,
      isNewUser: false,
    });

    await this.sessionManager.transition({ type: 'LOGIN_COMPLETED', userId });

    return { success: true, ...result };
  }

  /**
   * Handle USER_LOGGED_OUT message
   */
  private async handleUserLogout(): Promise<unknown> {
    this.ctx.debug.log('message', 'USER_LOGGED_OUT');

    await this.sessionManager.transition({ type: 'LOGOUT_STARTED' });
    await this.syncOrchestrator.handleLogout();
    await this.sessionManager.transition({ type: 'LOGOUT_COMPLETED' });

    return { success: true };
  }

  /**
   * Handle USER_ANONYMOUS message (ensure anonymous database is initialized)
   *
   * CRITICAL: This bypasses the SessionManager state machine intentionally.
   * The state guards in SessionManager prevent LOGOUT_STARTED/LOGOUT_COMPLETED
   * from working when the state is already ANONYMOUS (the default state).
   *
   * This handler directly initializes the database for anonymous users,
   * ensuring data isolation regardless of navigation path.
   */
  private async handleUserAnonymous(): Promise<unknown> {
    this.ctx.debug.log('message', 'USER_ANONYMOUS');

    // Get current state for logging
    const dbCurrentUserId = this.dbManager.getCurrentUserId();
    const dbUserId = this.dbManager.getUserId();
    const sessionUserId = this.sessionManager.getUserId();
    const sessionState = this.sessionManager.getState();

    console.log(
      `[USER_ANONYMOUS] BEFORE: dbCurrentUserId=${dbCurrentUserId}, dbUserId=${dbUserId}, sessionUserId=${sessionUserId}, sessionState=${sessionState}`
    );

    // If already anonymous with initialized database, this is idempotent
    // If database belongs to a different user, this will switch correctly
    await this.dbManager.ensureInitialized(null);

    const dbCurrentUserIdAfter = this.dbManager.getCurrentUserId();
    const dbUserIdAfter = this.dbManager.getUserId();

    console.log(
      `[USER_ANONYMOUS] AFTER: dbCurrentUserId=${dbCurrentUserIdAfter}, dbUserId=${dbUserIdAfter}`
    );

    this.ctx.debug.log('message', 'USER_ANONYMOUS: database ready for anonymous user');
    return { success: true };
  }

  /**
   * Handle SYNC_NOW message (manual sync trigger)
   */
  private async handleSyncNow(): Promise<unknown> {
    this.ctx.debug.log('message', 'SYNC_NOW');

    const result = await this.syncOrchestrator.fullSync();
    return { success: true, ...result };
  }

  /**
   * Handle RETRY_SYNC message (retry pending operations)
   */
  private async handleRetrySync(): Promise<unknown> {
    this.ctx.debug.log('message', 'RETRY_SYNC');

    this.syncOrchestrator.setOnlineStatus(true);
    const result = await this.syncOrchestrator.processPendingOperations();
    return { success: true, ...result };
  }

  /**
   * Handle SET_ONLINE_STATUS message
   */
  private async handleSetOnlineStatus(online: boolean): Promise<unknown> {
    this.ctx.debug.log('message', `SET_ONLINE_STATUS: online=${online}`);

    this.syncOrchestrator.setOnlineStatus(online);
    return { success: true, isOnline: online };
  }

  /**
   * Handle CLEAR_LOCAL_DATA message
   */
  private async handleClearLocalData(): Promise<unknown> {
    this.ctx.debug.log('message', 'CLEAR_LOCAL_DATA');

    const keyToClear = this.dbManager.getCurrentUserId();
    await clearUserDatabase(keyToClear);
    this.dbManager.close();

    return { success: true };
  }

  /**
   * Handle UPDATE_ENTRY message (update local entry from server)
   */
  private async handleUpdateEntry(entry: {
    id: string;
    date: string;
    content: string;
    userId: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
  }): Promise<unknown> {
    this.ctx.debug.log('message', 'UPDATE_ENTRY');

    const db = await this.dbManager.initDatabase();

    // Use the CRUD module to update the entry
    const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [entry.date]);

    if (entry.deletedAt) {
      // Delete if tombstone
      if (existing[0]?.values[0]) {
        db.run(`DELETE FROM entries WHERE date = ?`, [entry.date]);
      }
    } else {
      // Upsert entry
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

    await this.dbManager.persist();
    return { success: true };
  }

  /**
   * Handle EXPORT_DATA message (export all data for migration)
   */
  private async handleExportData(): Promise<unknown> {
    this.ctx.debug.log('message', 'EXPORT_DATA');

    const db = await this.dbManager.initDatabase();

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

    return {
      entries: entriesList,
      skipDays: skipDaysList,
      templates: templatesList,
    };
  }

  /**
   * Handle CHECK_USER_DATA message (check if user has data)
   */
  private async handleCheckUserData(userId: string): Promise<unknown> {
    this.ctx.debug.log('message', `CHECK_USER_DATA: userId=${userId}`);

    try {
      const db = await this.dbManager.ensureInitialized(userId);
      const result = db.exec(`SELECT COUNT(*) FROM entries`);
      const count = (result[0]?.values[0]?.[0] as number) || 0;

      return { hasData: count > 0 };
    } catch (error) {
      return { hasData: false, error: String(error) };
    }
  }

  /**
   * Handle DEBUG_STATE message (return service worker state)
   */
  private async handleDebugState(): Promise<unknown> {
    this.ctx.debug.log('message', 'DEBUG_STATE');

    const db = this.dbManager.getDatabase();
    let entryCount = 0;
    let sampleEntries: unknown[][] = [];

    if (db) {
      try {
        const countResult = db.exec(`SELECT COUNT(*) FROM entries`);
        entryCount = (countResult[0]?.values[0]?.[0] as number) || 0;
        const entriesResult = db.exec(
          `SELECT date, substr(content, 1, 40) as content FROM entries ORDER BY date DESC LIMIT 5`
        );
        sampleEntries = entriesResult[0]?.values || [];
      } catch {
        // Tables might not exist yet
      }
    }

    return {
      currentUserId: this.dbManager.getCurrentUserId(),
      sqliteDbUserId: this.dbManager.getUserId(),
      sqliteDbExists: !!db,
      userSwitchVersion: this.dbManager.getSwitchVersion(),
      isOnline: this.syncOrchestrator.getOnlineStatus(),
      syncInProgress: this.syncOrchestrator.isSyncing(),
      entryCount,
      sampleEntries,
      sessionState: this.sessionManager.getState(),
      note: 'Read-only state check',
    };
  }

  /**
   * Handle CHECK_PENDING_SYNC message
   */
  private async handleCheckPendingSync(): Promise<unknown> {
    this.ctx.debug.log('message', 'CHECK_PENDING_SYNC');

    try {
      const db = this.dbManager.getDatabase();
      if (!db) {
        return { hasPending: false, pendingCount: 0 };
      }

      const pending = pendingCrud.getPendingOperations(db);
      return {
        hasPending: pending.length > 0,
        pendingCount: pending.length,
        isOnline: this.syncOrchestrator.getOnlineStatus(),
      };
    } catch (error) {
      return { hasPending: false, pendingCount: 0, error: String(error) };
    }
  }
}
