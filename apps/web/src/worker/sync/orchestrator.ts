/**
 * SyncOrchestrator - Manages bidirectional sync between local database and server.
 *
 * Responsibilities:
 * - Full sync (pull from server, process pending operations)
 * - Pull from server (entries, skip days, templates)
 * - Push pending operations to server
 * - Handle login/logout sync transitions
 * - Conflict resolution (last-write-wins)
 *
 * Sync strategy (Last-Push-Wins):
 * 1. Pull from server first to get latest state
 * 2. Process pending operations (offline edits) - these push to server
 * 3. Pull again to reconcile any conflicts (server's version wins for same timestamp)
 */

import type {
  ServiceWorkerContext,
  SessionEvent,
  SyncEntry,
  SyncSkipDay,
  SyncTemplate,
  SyncPreferences,
  SyncWebhook,
  Database,
  FullSyncResult,
  PendingOperationsResult,
  UserLoginResult,
} from '../types';
import type { DatabaseManager } from '../database';
import * as entriesCrud from '../crud/entries';
import * as configCrud from '../crud/config';
import * as pendingCrud from '../crud/pending';
import * as preferencesCrud from '../crud/preferences';

// ====== Types ======

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}

export interface SyncApiClientInterface {
  getOnlineStatus(): boolean;
  fetchEntries(): Promise<SyncEntry[]>;
  fetchSkipDays(): Promise<SyncSkipDay[]>;
  fetchTemplates(): Promise<SyncTemplate[]>;
  pushEntry(entry: { date: string; content: string }): Promise<SyncEntry>;
  deleteEntry(date: string): Promise<void>;
  pushSkipDay(skipDay: { action: 'add' | 'remove'; type: 'weekday' | 'specific_date'; value: string; id?: string }): Promise<void>;
  pushTemplate(template: { action: 'create' | 'update' | 'delete' | 'setDefault'; id?: string | null; name?: string; content?: string }): Promise<void>;
}

// ====== SyncOrchestrator Implementation ======

export class SyncOrchestrator {
  private syncInProgress: boolean = false;
  private isOnline: boolean = true;
  private currentUserId: string | null = null;

  constructor(
    private ctx: ServiceWorkerContext,
    private dbManager: DatabaseManager,
    private apiUrl: string = ''
  ) {}

  // ====== State Accessors ======

  isSyncing(): boolean {
    return this.syncInProgress;
  }

  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  setOnlineStatus(online: boolean): void {
    if (this.isOnline !== online) {
      this.ctx.debug.log('sync', `Online status changed: ${this.isOnline} -> ${online}`);
      this.isOnline = online;

      // If back online and logged in, try to sync
      if (online && this.currentUserId) {
        this.processPendingOperations().catch((err) => {
          this.ctx.debug.log('sync', 'Auto-sync on reconnect failed:', err);
        });
      }
    }
  }

  setCurrentUserId(userId: string | null): void {
    this.currentUserId = userId;
  }

  // ====== Session Event Handlers ======

  /**
   * Called when user logs in
   * If new user, migrate anonymous data then sync
   * If existing user, pull from server first then merge
   */
  async handleLogin(event: SessionEvent): Promise<UserLoginResult> {
    const { userId, isNewUser, mergeAnonymous } = event;
    this.ctx.debug.log('sync', `handleLogin: userId=${userId}, isNewUser=${isNewUser}, mergeAnonymous=${mergeAnonymous}`);

    if (!userId) {
      return { migrated: false, merged: false, pulled: 0, mergedEntries: 0 };
    }

    this.currentUserId = userId;

    // For new users, trigger full sync after migration
    // For existing users, just pull from server
    if (isNewUser && this.isOnline) {
      try {
        const syncResult = await this.fullSync();
        this.ctx.debug.log('sync', `Login fullSync completed: pushed=${syncResult.pushed}, pulled=${syncResult.pulled}`);
        return { migrated: true, merged: false, pulled: syncResult.pulled, mergedEntries: 0 };
      } catch (error) {
        this.ctx.debug.log('sync', 'Login sync failed:', error);
        return { migrated: true, merged: false, pulled: 0, mergedEntries: 0 };
      }
    } else if (!isNewUser && this.isOnline) {
      // Existing user: just pull from server
      try {
        const pulled = await this.pullFromServer();
        return { migrated: false, merged: false, pulled, mergedEntries: 0 };
      } catch (error) {
        this.ctx.debug.log('sync', 'Login pull failed:', error);
        return { migrated: false, merged: false, pulled: 0, mergedEntries: 0 };
      }
    }

    return { migrated: false, merged: false, pulled: 0, mergedEntries: 0 };
  }

  /**
   * Called when user logs out
   * Clear sync state, persist database
   */
  async handleLogout(): Promise<void> {
    this.ctx.debug.log('sync', 'handleLogout');
    this.currentUserId = null;
    this.syncInProgress = false;
    // Database switching is handled by DatabaseManager
  }

  // ====== Full Sync ======

  /**
   * Full bidirectional sync
   *
   * Strategy:
   * 1. Pull from server first to get latest state
   * 2. Process pending operations (offline edits)
   * 3. If we pushed any pending ops, pull again to reconcile
   */
  async fullSync(): Promise<FullSyncResult> {
    if (this.syncInProgress) {
      this.ctx.debug.log('sync', 'Sync already in progress, skipping');
      return { pushed: 0, pulled: 0, pendingSynced: 0 };
    }

    if (!this.isOnline) {
      this.ctx.debug.log('sync', 'Offline, skipping sync');
      return { pushed: 0, pulled: 0, pendingSynced: 0 };
    }

    this.syncInProgress = true;
    this.ctx.debug.log('sync', 'Starting full sync...');

    try {
      // 1. Pull from server first to get latest state
      const pulled = await this.pullFromServer();

      // 2. Process pending operations from offline period
      const pendingResult = await this.processPendingOperationsInternal();
      const pendingSynced = pendingResult.synced;

      // 3. If we pushed any pending ops, pull again to reconcile
      if (pendingSynced > 0) {
        await this.pullFromServer();
      }

      this.ctx.debug.log('sync', `Full sync complete: pendingSynced=${pendingSynced}, pulled=${pulled}`);
      return { pushed: pendingSynced, pulled, pendingSynced };
    } catch (error) {
      this.ctx.debug.log('sync', 'Full sync failed:', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  // ====== Pull from Server ======

  /**
   * Pull all data from server and merge with local database
   * Uses last-write-wins conflict resolution
   */
  async pullFromServer(): Promise<number> {
    if (!this.isOnline) {
      this.ctx.debug.log('sync', 'Offline, skipping pull');
      return 0;
    }

    const db = this.dbManager.getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    this.ctx.debug.log('sync', `Pulling from server... currentUserId=${this.currentUserId}`);

    try {
      // Pull entries (including tombstones for deletion sync)
      const serverEntries = await this.fetchServerEntries();
      const activeEntries = serverEntries.filter(e => !e.deletedAt);
      const deletedEntries = serverEntries.filter(e => e.deletedAt);
      this.ctx.debug.log('sync', `Got ${serverEntries.length} entries from server (${activeEntries.length} active, ${deletedEntries.length} deleted)`);

      for (const entry of serverEntries) {
        this.updateLocalEntry(db, entry);
      }

      // Pull skip days
      try {
        const serverSkipDays = await this.fetchServerSkipDays();
        this.ctx.debug.log('sync', `Got ${serverSkipDays.length} skip days from server`);
        this.updateLocalSkipDays(db, serverSkipDays);
      } catch (error) {
        this.ctx.debug.log('sync', 'Failed to pull skip days:', error);
      }

      // Pull templates
      try {
        const serverTemplates = await this.fetchServerTemplates();
        this.ctx.debug.log('sync', `Got ${serverTemplates.length} templates from server`);
        this.updateLocalTemplates(db, serverTemplates);
      } catch (error) {
        this.ctx.debug.log('sync', 'Failed to pull templates:', error);
      }

      // Pull preferences
      try {
        const serverPreferences = await this.fetchServerPreferences();
        if (serverPreferences) {
          this.ctx.debug.log('sync', `Got preferences from server`);
          this.updateLocalPreferences(db, serverPreferences);
        }
      } catch (error) {
        this.ctx.debug.log('sync', 'Failed to pull preferences:', error);
      }

      // Pull webhooks (only for logged-in users, server is authoritative)
      if (this.currentUserId) {
        try {
          const serverWebhooks = await this.fetchServerWebhooks();
          this.ctx.debug.log('sync', `Got ${serverWebhooks.length} webhooks from server`);
          this.updateLocalWebhooks(db, serverWebhooks);
        } catch (error) {
          this.ctx.debug.log('sync', 'Failed to pull webhooks:', error);
        }
      }

      await this.dbManager.persist();
      this.ctx.debug.log('sync', `Pull complete: ${activeEntries.length} active entries, ${deletedEntries.length} deleted`);
      return activeEntries.length;
    } catch (error) {
      this.ctx.debug.log('sync', 'Pull failed:', error);
      throw error;
    }
  }

  // ====== Push to Server ======

  /**
   * Push all local data to server (used for new user migration)
   */
  async pushToServer(): Promise<number> {
    if (!this.isOnline) {
      this.ctx.debug.log('sync', 'Offline, skipping push');
      return 0;
    }

    const db = this.dbManager.getDatabase();
    if (!db) {
      throw new Error('Database not initialized');
    }

    this.ctx.debug.log('sync', 'Pushing to server...');

    try {
      // Push entries
      const localEntries = entriesCrud.getAllEntries(db);
      this.ctx.debug.log('sync', `Pushing ${localEntries.length} local entries`);

      let pushed = 0;
      for (const entry of localEntries) {
        await this.pushEntryToServer({ date: entry.date, content: entry.content });
        pushed++;
      }

      // Push skip days (server is idempotent - returns existing if duplicate)
      try {
        const skipDays = configCrud.getSkipDays(db);
        this.ctx.debug.log('sync', `Pushing ${skipDays.raw.length} skip days`);
        for (const skipDay of skipDays.raw) {
          await this.pushSkipDayToServer({
            action: 'add',
            type: skipDay.type,
            value: skipDay.value,
          });
        }
      } catch (error) {
        this.ctx.debug.log('sync', 'Failed to push skip days:', error);
      }

      // Push templates (server creates new, may cause duplicates which pull will reconcile)
      try {
        const templates = configCrud.getTemplates(db);
        this.ctx.debug.log('sync', `Pushing ${templates.length} templates`);
        for (const template of templates) {
          await this.pushTemplateToServer({
            action: 'create',
            name: template.name,
            content: template.content,
          });
        }
      } catch (error) {
        this.ctx.debug.log('sync', 'Failed to push templates:', error);
      }

      this.ctx.debug.log('sync', `Push complete: ${pushed} entries`);
      return pushed;
    } catch (error) {
      this.ctx.debug.log('sync', 'Push failed:', error);
      throw error;
    }
  }

  // ====== Process Pending Operations ======

  /**
   * Process pending offline operations (public version with sync lock)
   */
  async processPendingOperations(): Promise<PendingOperationsResult> {
    if (!this.isOnline || !this.currentUserId) {
      this.ctx.debug.log('sync', 'Skipping pending ops: offline or not logged in');
      return { synced: 0, failed: 0 };
    }

    if (this.syncInProgress) {
      this.ctx.debug.log('sync', 'Sync already in progress');
      return { synced: 0, failed: 0 };
    }

    this.syncInProgress = true;
    this.ctx.debug.log('sync', 'Processing pending operations...');

    try {
      return await this.processPendingOperationsInternal();
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Internal version without sync lock (called from fullSync)
   */
  private async processPendingOperationsInternal(): Promise<PendingOperationsResult> {
    if (!this.isOnline || !this.currentUserId) {
      return { synced: 0, failed: 0 };
    }

    const db = this.dbManager.getDatabase();
    if (!db) {
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    const pending = pendingCrud.getPendingOperations(db);
    this.ctx.debug.log('sync', `Processing ${pending.length} pending operations`);

    for (const op of pending) {
      try {
        if (op.type === 'upsert' && op.content !== undefined) {
          await this.pushEntryToServer({ date: op.date, content: op.content });
        } else if (op.type === 'delete') {
          await this.deleteEntryOnServer(op.date);
        } else if (op.type === 'skip_day' && op.payload) {
          const payload = JSON.parse(op.payload);
          await this.pushSkipDayToServer(payload);
        } else if (op.type === 'template' && op.payload) {
          const payload = JSON.parse(op.payload);
          await this.pushTemplateToServer(payload);
        } else if (op.type === 'webhook' && op.payload) {
          const payload = JSON.parse(op.payload);
          await this.pushWebhookToServer(payload);
        }
        pendingCrud.clearPendingOperation(db, op.id);
        synced++;
      } catch (error) {
        this.ctx.debug.log('sync', `Failed to sync op ${op.id}:`, error);
        failed++;
        // Don't clear failed operations - they'll be retried
      }
    }

    if (synced > 0) {
      await this.dbManager.persist();
    }

    return { synced, failed };
  }

  // ====== Server API Functions ======

  /**
   * Fetch all entries from server using cursor-based pagination
   */
  private async fetchServerEntries(): Promise<SyncEntry[]> {
    const allEntries: SyncEntry[] = [];
    let cursor: string | undefined;
    const PAGE_SIZE = 50;

    do {
      const input = { limit: PAGE_SIZE, includeDeleted: true, cursor };
      const response = await fetch(
        `${this.apiUrl}/trpc/entries.list?input=${encodeURIComponent(JSON.stringify(input))}`,
        { credentials: 'include' }
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

      this.ctx.debug.log('sync', `Fetched ${entries.length} entries, total: ${allEntries.length}, hasMore: ${!!cursor}`);
    } while (cursor);

    return allEntries;
  }

  /**
   * Fetch skip days from server
   */
  private async fetchServerSkipDays(): Promise<SyncSkipDay[]> {
    const response = await fetch(`${this.apiUrl}/trpc/config.getSkipDays`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const result = data.result?.data;
    const raw = result?.raw || [];

    return raw.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      type: item.type as 'weekday' | 'specific_date',
      value: item.value as string,
      userId: (item.userId as string) ?? null,
      createdAt: item.createdAt as string,
    }));
  }

  /**
   * Fetch templates from server
   */
  private async fetchServerTemplates(): Promise<SyncTemplate[]> {
    const response = await fetch(`${this.apiUrl}/trpc/config.getTemplates`, {
      credentials: 'include',
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
  }

  /**
   * Fetch preferences from server
   */
  private async fetchServerPreferences(): Promise<SyncPreferences | null> {
    const response = await fetch(`${this.apiUrl}/trpc/config.getPreferences`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const result = data.result?.data;

    if (!result) {
      return null;
    }

    return {
      id: result.id,
      userId: result.userId,
      aiConfig: result.aiConfig ?? null,
      theme: result.theme ?? null,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  }

  /**
   * Push entry to server
   */
  async pushEntryToServer(entry: { date: string; content: string }): Promise<SyncEntry> {
    const response = await fetch(`${this.apiUrl}/trpc/entries.upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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

  /**
   * Delete entry on server
   */
  private async deleteEntryOnServer(date: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/trpc/entries.delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ date }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  }

  /**
   * Push skip day to server
   */
  async pushSkipDayToServer(skipDay: { action: 'add' | 'remove'; type: 'weekday' | 'specific_date'; value: string; id?: string }): Promise<void> {
    if (skipDay.action === 'add') {
      const procedure = skipDay.type === 'weekday' ? 'config.addSkipWeekday' : 'config.addSkipDate';
      const input = skipDay.type === 'weekday'
        ? { weekday: parseInt(skipDay.value) }
        : { date: skipDay.value };

      const response = await fetch(`${this.apiUrl}/trpc/${procedure}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } else if (skipDay.action === 'remove' && skipDay.id) {
      const response = await fetch(`${this.apiUrl}/trpc/config.removeSkipDay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: skipDay.id }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    }

    this.ctx.debug.log('sync', `Pushed skip day to server: ${skipDay.action} ${skipDay.type}=${skipDay.value}`);
  }

  /**
   * Push template to server
   */
  async pushTemplateToServer(template: { action: 'create' | 'update' | 'delete' | 'setDefault'; id?: string | null; name?: string; content?: string }): Promise<void> {
    let procedure: string;
    let input: Record<string, unknown>;

    switch (template.action) {
      case 'create':
        procedure = 'config.createTemplate';
        input = { name: template.name, content: template.content };
        break;
      case 'update':
        procedure = 'config.updateTemplate';
        input = { id: template.id, name: template.name, content: template.content };
        break;
      case 'delete':
        procedure = 'config.deleteTemplate';
        input = { id: template.id };
        break;
      case 'setDefault':
        procedure = 'config.setDefaultTemplate';
        input = { id: template.id ?? null };
        break;
      default:
        throw new Error(`Unknown template action: ${template.action}`);
    }

    const response = await fetch(`${this.apiUrl}/trpc/${procedure}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    this.ctx.debug.log('sync', `Pushed template to server: ${template.action} ${template.id || template.name}`);
  }

  /**
   * Fetch webhooks from server
   */
  private async fetchServerWebhooks(): Promise<SyncWebhook[]> {
    const response = await fetch(`${this.apiUrl}/trpc/webhooks.list`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch webhooks: ${response.status}`);
    }
    const data = await response.json();
    return data.result?.data ?? [];
  }

  /**
   * Push webhook to server
   */
  async pushWebhookToServer(payload: {
    action: 'create' | 'update' | 'delete';
    webhook?: SyncWebhook;
    webhookId?: string;
  }): Promise<void> {
    if (!this.currentUserId) return;

    let endpoint: string;
    let body: unknown;

    switch (payload.action) {
      case 'create':
        endpoint = `${this.apiUrl}/trpc/webhooks.create`;
        body = {
          name: payload.webhook!.name,
          url: payload.webhook!.url,
          message: payload.webhook!.message,
          time: payload.webhook!.time,
          days: payload.webhook!.days,
          timezone: payload.webhook!.timezone,
        };
        break;
      case 'update':
        endpoint = `${this.apiUrl}/trpc/webhooks.update`;
        body = {
          id: payload.webhook!.id,
          name: payload.webhook!.name,
          url: payload.webhook!.url,
          message: payload.webhook!.message,
          time: payload.webhook!.time,
          days: payload.webhook!.days,
          timezone: payload.webhook!.timezone,
          enabled: payload.webhook!.enabled,
        };
        break;
      case 'delete':
        endpoint = `${this.apiUrl}/trpc/webhooks.delete`;
        body = { id: payload.webhookId };
        break;
    }

    await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ====== Local Database Update Helpers ======

  /**
   * Update local entry from server data (handles tombstones for deletion sync)
   */
  private updateLocalEntry(db: Database, entry: SyncEntry): void {
    const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [entry.date]);

    // If entry is deleted on server, delete locally
    if (entry.deletedAt) {
      if (existing[0]?.values[0]) {
        db.run(`DELETE FROM entries WHERE date = ?`, [entry.date]);
        this.ctx.debug.log('sync', `Deleted local entry for ${entry.date} (tombstone from server)`);
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

  /**
   * Update local skip days from server data (server is source of truth)
   */
  private updateLocalSkipDays(db: Database, serverSkipDays: SyncSkipDay[]): void {
    // Get current local skip days
    const localResults = db.exec(`SELECT id, type, value FROM skip_days`);
    const localMap = new Map<string, { id: string; type: string; value: string }>();
    if (localResults[0]?.values) {
      for (const row of localResults[0].values) {
        const key = `${row[1]}-${row[2]}`;
        localMap.set(key, { id: row[0] as string, type: row[1] as string, value: row[2] as string });
      }
    }

    // Server skip days map
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

  /**
   * Update local templates from server data (last-write-wins)
   */
  private updateLocalTemplates(db: Database, serverTemplates: SyncTemplate[]): void {
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
          if (p.action === 'create' && p.name) {
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
          this.ctx.debug.log('sync', `Protecting pending template from deletion: ${templateName}`);
          continue; // Don't delete - it has a pending sync
        }
        db.run(`DELETE FROM templates WHERE id = ?`, [localId]);
      }
    }
  }

  /**
   * Update local preferences from server data
   * Server is source of truth for preferences
   */
  private updateLocalPreferences(db: Database, serverPrefs: SyncPreferences): void {
    if (!this.currentUserId) return;

    preferencesCrud.setPreferences(db, this.currentUserId, {
      aiConfig: serverPrefs.aiConfig ?? undefined,
      theme: serverPrefs.theme ?? undefined,
    });
  }

  /**
   * Update local webhooks from server data (server is authoritative for webhooks)
   */
  private updateLocalWebhooks(db: Database, serverWebhooks: SyncWebhook[]): void {
    // Clear existing webhooks for this user
    db.run('DELETE FROM webhooks WHERE user_id = ?', [this.currentUserId]);

    // Insert server webhooks
    for (const webhook of serverWebhooks) {
      db.run(
        `INSERT INTO webhooks (id, name, url, message, time, days, timezone, enabled, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          webhook.id,
          webhook.name,
          webhook.url,
          webhook.message,
          webhook.time,
          JSON.stringify(webhook.days),
          webhook.timezone,
          webhook.enabled ? 1 : 0,
          this.currentUserId,
          webhook.createdAt,
          webhook.updatedAt,
        ]
      );
    }
  }
}
