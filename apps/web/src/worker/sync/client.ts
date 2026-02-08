/**
 * Server communication client for sync operations
 *
 * Extracted from service-worker.ts to centralize all server API calls.
 * Handles entries, skip days, and templates sync with the backend.
 */

import type { ServiceWorkerContext } from '../types';

// ====== SERVER TYPES ======

export interface ServerEntry {
  id: string;
  date: string;
  content: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ServerSkipDay {
  id: string;
  type: 'weekday' | 'specific_date';
  value: string;
  userId: string | null;
  createdAt: string;
}

export interface ServerTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ====== SYNC API CLIENT ======

export class SyncApiClient {
  private isOnline: boolean = true;
  private readonly API_URL = ''; // Empty means same origin, will be proxied

  constructor(private ctx: ServiceWorkerContext) {}

  setOnlineStatus(online: boolean): void {
    this.isOnline = online;
  }

  getOnlineStatus(): boolean {
    return this.isOnline;
  }

  // ===== ENTRIES =====

  /**
   * Fetch ALL entries from server using cursor-based pagination
   * Handles users with more than 1000 entries by fetching in batches
   */
  async fetchEntries(): Promise<ServerEntry[]> {
    const allEntries: ServerEntry[] = [];
    let cursor: string | undefined;
    const PAGE_SIZE = 50; // Server limit is 50 max

    try {
      do {
        // Include deleted entries (tombstones) for sync to handle deletions across devices
        const input = { limit: PAGE_SIZE, includeDeleted: true, cursor };
        const response = await fetch(
          `${this.API_URL}/trpc/entries.list?input=${encodeURIComponent(JSON.stringify(input))}`,
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

        console.log(`[SyncApiClient] Fetched ${entries.length} entries, total: ${allEntries.length}, hasMore: ${!!cursor}`);
      } while (cursor);

      return allEntries;
    } catch (error) {
      console.error('[SyncApiClient] Failed to fetch server entries:', error);
      throw error;
    }
  }

  /**
   * Push entry to server
   */
  async pushEntry(entry: { date: string; content: string }): Promise<ServerEntry> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/entries.upsert`, {
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
    } catch (error) {
      console.error('[SyncApiClient] Failed to push entry:', error);
      throw error;
    }
  }

  /**
   * Delete entry on server
   */
  async deleteEntry(date: string): Promise<void> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/entries.delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ date }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error('[SyncApiClient] Failed to delete entry:', error);
      throw error;
    }
  }

  // ===== SKIP DAYS =====

  /**
   * Fetch skip days from server
   */
  async fetchSkipDays(): Promise<ServerSkipDay[]> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/config.getSkipDays`, {
        credentials: 'include',
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
        type: item.type as 'weekday' | 'specific_date',
        value: item.value as string,
        userId: (item.userId as string) ?? null,
        createdAt: item.createdAt as string,
      }));
    } catch (error) {
      console.error('[SyncApiClient] Failed to fetch server skip days:', error);
      throw error;
    }
  }

  /**
   * Push skip day to server
   */
  async pushSkipDay(skipDay: {
    action: 'add' | 'remove';
    type: 'weekday' | 'specific_date';
    value: string;
    id?: string;
  }): Promise<void> {
    try {
      if (skipDay.action === 'add') {
        const procedure = skipDay.type === 'weekday' ? 'config.addSkipWeekday' : 'config.addSkipDate';
        const input = skipDay.type === 'weekday'
          ? { weekday: parseInt(skipDay.value) }
          : { date: skipDay.value };

        const response = await fetch(`${this.API_URL}/trpc/${procedure}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
      } else if (skipDay.action === 'remove' && skipDay.id) {
        const response = await fetch(`${this.API_URL}/trpc/config.removeSkipDay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: skipDay.id }),
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
      }
      console.log(`[SyncApiClient] Pushed skip day to server: ${skipDay.action} ${skipDay.type}=${skipDay.value}`);
    } catch (error) {
      console.error('[SyncApiClient] Failed to push skip day:', error);
      throw error;
    }
  }

  /**
   * Delete skip day on server
   */
  async deleteSkipDay(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/config.removeSkipDay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error('[SyncApiClient] Failed to delete skip day:', error);
      throw error;
    }
  }

  // ===== TEMPLATES =====

  /**
   * Fetch templates from server
   */
  async fetchTemplates(): Promise<ServerTemplate[]> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/config.getTemplates`, {
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
    } catch (error) {
      console.error('[SyncApiClient] Failed to fetch server templates:', error);
      throw error;
    }
  }

  /**
   * Push template to server (create, update, delete, or set default)
   */
  async pushTemplate(template: {
    action: 'create' | 'update' | 'delete' | 'setDefault';
    id?: string | null;
    name?: string;
    content?: string;
  }): Promise<void> {
    try {
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

      const response = await fetch(`${this.API_URL}/trpc/${procedure}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      console.log(`[SyncApiClient] Pushed template to server: ${template.action} ${template.id || template.name}`);
    } catch (error) {
      console.error('[SyncApiClient] Failed to push template:', error);
      throw error;
    }
  }

  /**
   * Delete template on server
   */
  async deleteTemplate(id: string): Promise<void> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/config.deleteTemplate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error('[SyncApiClient] Failed to delete template:', error);
      throw error;
    }
  }

  /**
   * Set default template on server
   */
  async setDefaultTemplate(id: string | null): Promise<void> {
    try {
      const response = await fetch(`${this.API_URL}/trpc/config.setDefaultTemplate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error('[SyncApiClient] Failed to set default template:', error);
      throw error;
    }
  }
}
