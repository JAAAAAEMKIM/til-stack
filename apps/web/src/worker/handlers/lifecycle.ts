/**
 * LifecycleHandler - Manages service worker lifecycle events
 *
 * Responsibilities:
 * - Install event: Skip waiting, pre-cache static assets
 * - Activate event: Claim clients, clean up old caches
 * - Sync event: Handle background sync for pending operations
 * - Message event: Handle user login/logout, sync triggers
 *
 * Integration points:
 * - DatabaseManager: For database initialization and persistence
 * - SyncOrchestrator: For managing bidirectional sync operations
 */

import type { ServiceWorkerContext } from '../types';
import type { DatabaseManager } from '../database';
import type { SyncOrchestrator } from '../sync/orchestrator';

declare const self: ServiceWorkerGlobalScope;

/**
 * Type for Background Sync API (not in default lib.dom.d.ts)
 */
interface SyncEvent extends ExtendableEvent {
  tag: string;
}

/**
 * LifecycleHandler class for managing service worker lifecycle events
 */
export class LifecycleHandler {
  private cacheName: string = 'til-stack-v2';
  private syncTag: string = 'til-stack-sync';

  constructor(
    private ctx: ServiceWorkerContext,
    private dbManager: DatabaseManager,
    private syncOrchestrator: SyncOrchestrator,
    cacheName?: string,
    syncTag?: string
  ) {
    if (cacheName) this.cacheName = cacheName;
    if (syncTag) this.syncTag = syncTag;
  }

  /**
   * Handle service worker install event
   * Pre-cache static assets and skip waiting for immediate activation
   */
  async handleInstall(event: ExtendableEvent): Promise<void> {
    this.ctx.debug.log('lifecycle', 'Service worker installing...');

    event.waitUntil(
      (async () => {
        try {
          // Pre-cache essential static assets for offline support
          const cache = await caches.open(this.cacheName);
          this.ctx.debug.log('lifecycle', 'Pre-caching static assets...');

          const staticAssets = [
            '/',
            '/index.html',
            '/sql.js/sql-wasm.wasm',
          ];

          // Cache essential files
          for (const url of staticAssets) {
            try {
              await cache.add(url);
              this.ctx.debug.log('lifecycle', `Cached: ${url}`);
            } catch (err) {
              this.ctx.debug.log('lifecycle', `Failed to cache ${url}:`, err);
              // Continue caching other files even if one fails
            }
          }

          // Skip waiting to activate immediately
          await self.skipWaiting();
          this.ctx.debug.log('lifecycle', 'Service worker installed and activated immediately');
        } catch (err) {
          this.ctx.debug.log('lifecycle', 'Install error:', err);
          throw err;
        }
      })()
    );
  }

  /**
   * Handle service worker activate event
   * Clean up old caches and claim all clients
   */
  async handleActivate(event: ExtendableEvent): Promise<void> {
    this.ctx.debug.log('lifecycle', 'Service worker activating...');

    event.waitUntil(
      (async () => {
        try {
          // Claim all clients immediately
          await self.clients.claim();
          this.ctx.debug.log('lifecycle', 'All clients claimed');

          // Clean up old caches
          const cacheNames = await caches.keys();
          const oldCaches = cacheNames.filter((name) => name !== this.cacheName);

          await Promise.all(
            oldCaches.map((name) => {
              this.ctx.debug.log('lifecycle', `Deleting old cache: ${name}`);
              return caches.delete(name);
            })
          );

          this.ctx.debug.log('lifecycle', 'Service worker activated');
        } catch (err) {
          this.ctx.debug.log('lifecycle', 'Activate error:', err);
          throw err;
        }
      })()
    );
  }

  /**
   * Handle background sync event
   * Triggers when device comes back online (if Background Sync API is supported)
   * Processes any pending operations that were queued while offline
   */
  async handleSync(event: SyncEvent): Promise<void> {
    this.ctx.debug.log('lifecycle', `Background sync triggered: ${event.tag}`);

    // Only handle our specific sync tag
    if (event.tag !== this.syncTag) {
      this.ctx.debug.log('lifecycle', `Ignoring unknown sync tag: ${event.tag}`);
      return;
    }

    event.waitUntil(
      (async () => {
        try {
          this.ctx.debug.log('lifecycle', 'Processing background sync...');

          // Process all pending operations
          const result = await this.syncOrchestrator.processPendingOperations();
          this.ctx.debug.log('lifecycle', `Background sync complete: synced=${result.synced}, failed=${result.failed}`);

          // If there are still failures, reject to retry later
          if (result.failed > 0) {
            throw new Error(`${result.failed} operations failed during background sync`);
          }
        } catch (err) {
          this.ctx.debug.log('lifecycle', 'Background sync error:', err);
          // Rethrow to signal retry to the browser
          throw err;
        }
      })()
    );
  }

  /**
   * Register for background sync (if supported by browser)
   * This will trigger handleSync when device comes back online
   */
  async registerBackgroundSync(): Promise<boolean> {
    try {
      const registration = self.registration;
      if ('sync' in registration) {
        const syncReg = registration as ServiceWorkerRegistration & {
          sync: { register: (tag: string) => Promise<void> };
        };
        await syncReg.sync.register(this.syncTag);
        this.ctx.debug.log('lifecycle', `Background sync registered: ${this.syncTag}`);
        return true;
      }
    } catch (error) {
      this.ctx.debug.log('lifecycle', 'Background sync registration failed:', error);
    }
    return false;
  }
}
