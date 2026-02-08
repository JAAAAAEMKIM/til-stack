/**
 * RequestHandler - Handles tRPC-like requests for the service worker.
 *
 * Routes requests to appropriate CRUD operations and manages:
 * - Entry operations (list, getByDate, upsert, delete, etc.)
 * - Config operations (skip days, templates)
 * - Pending operation queue for offline sync
 * - Background sync triggering
 */

import type { ServiceWorkerContext, Database } from '../types';
import type { DatabaseManager } from '../database';
import type { SyncOrchestrator } from '../sync/orchestrator';
import * as entriesCrud from '../crud/entries';
import * as configCrud from '../crud/config';
import * as pendingCrud from '../crud/pending';
import * as preferencesCrud from '../crud/preferences';
import * as webhooksCrud from '../crud/webhooks';

// ====== Types ======

export interface RequestHandlerConfig {
  /** Current user ID (null for anonymous) */
  getCurrentUserId: () => string | null;
  /** Check if online */
  getOnlineStatus: () => boolean;
  /** Register background sync */
  registerBackgroundSync: () => Promise<void>;
}

// ====== RequestHandler Implementation ======

export class RequestHandler {
  constructor(
    private ctx: ServiceWorkerContext,
    private dbManager: DatabaseManager,
    private syncOrchestrator: SyncOrchestrator,
    private config: RequestHandlerConfig
  ) {}

  // ====== Main Entry Point ======

  /**
   * Handle a tRPC-like request locally.
   * Routes to appropriate handler based on procedure path.
   *
   * @param procedure - The procedure path (e.g., "entries.list", "config.getSkipDays")
   * @param input - The input parameters for the procedure
   * @returns The result of the procedure
   */
  async handleLocalRequest(procedure: string, input: unknown): Promise<unknown> {
    this.ctx.debug.log('request', `handleLocalRequest: ${procedure}`);

    // Debug: Log the current state before initializing database
    const dbCurrentUserId = this.dbManager.getCurrentUserId();
    const dbUserId = this.dbManager.getUserId();
    console.log(
      `[handleLocalRequest] ${procedure}: dbCurrentUserId=${dbCurrentUserId}, dbUserId=${dbUserId}`
    );

    // Initialize database. The dbManager tracks its own currentUserId which is
    // updated by USER_ANONYMOUS/USER_LOGGED_IN messages. We don't pass a userId
    // here because the auth flow should have already set the correct user via
    // those message handlers before any tRPC requests arrive.
    const db = await this.dbManager.ensureInitialized();

    // Parse procedure path (e.g., "entries.list" -> ["entries", "list"])
    const [router, method] = procedure.split('.');

    switch (router) {
      case 'entries':
        return this.handleEntries(db, method, input);
      case 'config':
        return this.handleConfig(db, method, input);
      case 'webhooks':
        return this.handleWebhooks(db, method, input);
      case 'auth':
        // In local-first mode, return null for auth.me (same as server when not logged in)
        return null;
      default:
        return { error: `Unknown router: ${router}` };
    }
  }

  // ====== Entries Handler ======

  private async handleEntries(db: Database, method: string, input: unknown): Promise<unknown> {
    switch (method) {
      case 'list': {
        const params = (input as entriesCrud.ListEntriesParams) || {};
        return entriesCrud.listEntries(db, params);
      }

      case 'getByDate': {
        const { date } = input as { date: string };
        return entriesCrud.getEntryByDate(db, date);
      }

      case 'getByDateRange': {
        const { startDate, endDate } = input as { startDate: string; endDate: string };
        return entriesCrud.getEntriesByDateRange(db, startDate, endDate);
      }

      case 'getWeeklySummary': {
        const params = input as entriesCrud.WeeklySummaryParams;
        return entriesCrud.getWeeklySummary(db, params);
      }

      case 'getMonthlySummary': {
        const params = input as entriesCrud.MonthlySummaryParams;
        return entriesCrud.getMonthlySummary(db, params);
      }

      case 'upsert': {
        const { date, content } = input as { date: string; content: string };
        const entry = entriesCrud.upsertEntry(db, { date, content });

        // Persist immediately
        await this.dbManager.persist();

        // If logged in, sync this entry to server
        const userId = this.config.getCurrentUserId();
        if (userId) {
          if (this.config.getOnlineStatus()) {
            // Online: push directly in background
            this.syncOrchestrator.pushEntryToServer({ date, content }).catch((err) => {
              this.ctx.debug.log('request', 'Background push failed:', err);
              // If push fails, add to pending
              pendingCrud.addPendingOperation(db, {
                type: 'upsert',
                date,
                content,
              });
              this.dbManager.persist().catch(() => {});
              this.config.registerBackgroundSync().catch(() => {});
            });
          } else {
            // Offline: add to pending operations
            pendingCrud.addPendingOperation(db, {
              type: 'upsert',
              date,
              content,
            });
            await this.dbManager.persist();
            await this.config.registerBackgroundSync();
            this.ctx.debug.log('request', `Offline: queued upsert for ${date}`);
          }
        }

        return entry;
      }

      case 'delete': {
        const { date } = input as { date: string };
        entriesCrud.deleteEntry(db, date);

        // Persist immediately
        await this.dbManager.persist();

        // If logged in, sync deletion to server
        const userId = this.config.getCurrentUserId();
        if (userId) {
          if (this.config.getOnlineStatus()) {
            // Online: delete directly in background
            fetch(`${this.ctx.apiUrl}/trpc/entries.delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ date }),
            }).catch((err) => {
              this.ctx.debug.log('request', 'Background delete failed:', err);
              // If delete fails, add to pending
              pendingCrud.addPendingOperation(db, { type: 'delete', date });
              this.dbManager.persist().catch(() => {});
              this.config.registerBackgroundSync().catch(() => {});
            });
          } else {
            // Offline: add to pending operations
            pendingCrud.addPendingOperation(db, { type: 'delete', date });
            await this.dbManager.persist();
            await this.config.registerBackgroundSync();
            this.ctx.debug.log('request', `Offline: queued delete for ${date}`);
          }
        }

        return { success: true };
      }

      default:
        return { error: `Unknown method: ${method}` };
    }
  }

  // ====== Config Handler ======

  private async handleConfig(db: Database, method: string, input: unknown): Promise<unknown> {
    switch (method) {
      case 'getSkipDays': {
        return configCrud.getSkipDays(db);
      }

      case 'getTemplates': {
        return configCrud.getTemplates(db);
      }

      case 'getDefaultTemplate': {
        return configCrud.getDefaultTemplate(db);
      }

      case 'addSkipWeekday': {
        const { weekday } = input as { weekday: number };
        const skipDay = configCrud.addSkipWeekday(db, weekday);
        await this.dbManager.persist();

        // Sync to server if logged in
        await this.syncSkipDayOperation(db, {
          action: 'add',
          type: 'weekday',
          value: weekday.toString(),
        });

        return skipDay;
      }

      case 'addSkipDate': {
        const { date } = input as { date: string };
        const skipDay = configCrud.addSkipDate(db, date);
        await this.dbManager.persist();

        // Sync to server if logged in
        await this.syncSkipDayOperation(db, {
          action: 'add',
          type: 'specific_date',
          value: date,
        });

        return skipDay;
      }

      case 'removeSkipDay': {
        const { id } = input as { id: string };
        const removed = configCrud.removeSkipDay(db, id);
        await this.dbManager.persist();

        // Sync to server if logged in
        if (removed) {
          await this.syncSkipDayOperation(db, {
            action: 'remove',
            type: removed.type,
            value: removed.value,
            id,
          });
        }

        return { success: true };
      }

      case 'createTemplate': {
        const { name, content } = input as { name: string; content: string };
        const template = configCrud.createTemplate(db, { name, content });
        await this.dbManager.persist();

        // Sync to server if logged in
        await this.syncTemplateOperation(db, {
          action: 'create',
          name,
          content,
        });

        return template;
      }

      case 'updateTemplate': {
        const { id, name, content } = input as { id: string; name?: string; content?: string };
        const template = configCrud.updateTemplate(db, id, { name, content });
        await this.dbManager.persist();

        // Sync to server if logged in
        await this.syncTemplateOperation(db, {
          action: 'update',
          id,
          name,
          content,
        });

        return template;
      }

      case 'deleteTemplate': {
        const { id } = input as { id: string };
        configCrud.deleteTemplate(db, id);
        await this.dbManager.persist();

        // Sync to server if logged in
        await this.syncTemplateOperation(db, {
          action: 'delete',
          id,
        });

        return { success: true };
      }

      case 'setDefaultTemplate': {
        const { id } = input as { id: string | null };
        configCrud.setDefaultTemplate(db, id);
        await this.dbManager.persist();

        // Sync to server if logged in
        await this.syncTemplateOperation(db, {
          action: 'setDefault',
          id,
        });

        return { success: true };
      }

      case 'getPreferences': {
        const userId = this.config.getCurrentUserId();
        return preferencesCrud.getPreferences(db, userId);
      }

      case 'setPreferences': {
        const userId = this.config.getCurrentUserId();
        const updates = input as { aiConfig?: string; theme?: string };
        const prefs = preferencesCrud.setPreferences(db, userId, updates);
        await this.dbManager.persist();

        // Sync to server only if logged in and online
        if (userId) {
          await this.syncPreferencesOperation(updates);
        }

        return prefs;
      }

      default:
        return { error: `Unknown method: ${method}` };
    }
  }

  // ====== Webhooks Handler ======

  private async handleWebhooks(db: Database, method: string, input: unknown): Promise<unknown> {
    const userId = this.config.getCurrentUserId();

    // CRITICAL: Block anonymous users - webhooks require login
    if (!userId) {
      throw new Error('Webhooks require login. Please sign in to use this feature.');
    }

    switch (method) {
      case 'list':
        return webhooksCrud.getWebhooks(db, userId);

      case 'create': {
        const createInput = input as webhooksCrud.CreateWebhookInput;
        const created = webhooksCrud.createWebhook(db, userId, createInput);
        await this.dbManager.persist();

        // Sync to server in background
        await this.syncWebhookOperation(db, { action: 'create', webhook: created });

        return created;
      }

      case 'update': {
        const { id, ...updates } = input as { id: string } & webhooksCrud.UpdateWebhookInput;
        const updated = webhooksCrud.updateWebhook(db, userId, id, updates);
        if (updated) {
          await this.dbManager.persist();
          await this.syncWebhookOperation(db, { action: 'update', webhook: updated });
        }
        return updated;
      }

      case 'delete': {
        const { id } = input as { id: string };
        const deleted = webhooksCrud.deleteWebhook(db, userId, id);
        if (deleted) {
          await this.dbManager.persist();
          await this.syncWebhookOperation(db, { action: 'delete', webhookId: id });
        }
        return { success: deleted };
      }

      default:
        throw new Error(`Unknown webhooks method: ${method}`);
    }
  }

  // ====== Sync Helpers ======

  /**
   * Sync skip day operation to server (or queue if offline)
   */
  private async syncSkipDayOperation(
    db: Database,
    payload: {
      action: 'add' | 'remove';
      type: 'weekday' | 'specific_date';
      value: string;
      id?: string;
    }
  ): Promise<void> {
    const userId = this.config.getCurrentUserId();
    if (!userId) return;

    if (this.config.getOnlineStatus()) {
      this.syncOrchestrator.pushSkipDayToServer(payload).catch((err) => {
        this.ctx.debug.log('request', 'Background skip day push failed:', err);
        pendingCrud.addPendingOperation(db, {
          type: 'skip_day',
          date: '',
          payload: JSON.stringify(payload),
        });
        this.dbManager.persist().catch(() => {});
        this.config.registerBackgroundSync().catch(() => {});
      });
    } else {
      pendingCrud.addPendingOperation(db, {
        type: 'skip_day',
        date: '',
        payload: JSON.stringify(payload),
      });
      await this.dbManager.persist();
      await this.config.registerBackgroundSync();
    }
  }

  /**
   * Sync template operation to server (or queue if offline)
   */
  private async syncTemplateOperation(
    db: Database,
    payload: {
      action: 'create' | 'update' | 'delete' | 'setDefault';
      id?: string | null;
      name?: string;
      content?: string;
    }
  ): Promise<void> {
    const userId = this.config.getCurrentUserId();
    if (!userId) return;

    if (this.config.getOnlineStatus()) {
      this.syncOrchestrator.pushTemplateToServer(payload).catch((err) => {
        this.ctx.debug.log('request', 'Background template push failed:', err);
        pendingCrud.addPendingOperation(db, {
          type: 'template',
          date: '',
          payload: JSON.stringify(payload),
        });
        this.dbManager.persist().catch(() => {});
        this.config.registerBackgroundSync().catch(() => {});
      });
    } else {
      pendingCrud.addPendingOperation(db, {
        type: 'template',
        date: '',
        payload: JSON.stringify(payload),
      });
      await this.dbManager.persist();
      await this.config.registerBackgroundSync();
    }
  }

  /**
   * Sync preferences to server (if online)
   * For preferences, we don't queue offline operations - just sync when online
   */
  private async syncPreferencesOperation(
    updates: { aiConfig?: string; theme?: string }
  ): Promise<void> {
    const userId = this.config.getCurrentUserId();
    if (!userId) return;

    if (this.config.getOnlineStatus()) {
      // Push to server directly
      try {
        await fetch(`${this.ctx.apiUrl}/trpc/config.setPreferences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updates),
        });
        this.ctx.debug.log('request', 'Preferences synced to server');
      } catch (err) {
        this.ctx.debug.log('request', 'Preferences sync failed:', err);
        // Don't queue - preferences can be re-synced on next change
      }
    }
  }

  /**
   * Sync webhook operation to server (or queue if offline)
   */
  private async syncWebhookOperation(
    db: Database,
    payload: {
      action: 'create' | 'update' | 'delete';
      webhook?: webhooksCrud.Webhook;
      webhookId?: string;
    }
  ): Promise<void> {
    const userId = this.config.getCurrentUserId();
    if (!userId) return;

    if (this.config.getOnlineStatus()) {
      this.syncOrchestrator.pushWebhookToServer(payload).catch((err) => {
        this.ctx.debug.log('request', 'Background webhook push failed:', err);
        pendingCrud.addPendingOperation(db, {
          type: 'webhook',
          date: '',
          payload: JSON.stringify(payload),
        });
        this.dbManager.persist().catch(() => {});
        this.config.registerBackgroundSync().catch(() => {});
      });
    } else {
      pendingCrud.addPendingOperation(db, {
        type: 'webhook',
        date: '',
        payload: JSON.stringify(payload),
      });
      await this.dbManager.persist();
      await this.config.registerBackgroundSync();
    }
  }
}
