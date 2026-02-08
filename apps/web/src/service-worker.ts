/// <reference lib="webworker" />

/**
 * Service Worker - Minimal version for background sync only
 *
 * All tRPC request handling has been moved to SharedWorker.
 * This service worker only handles browser-initiated events:
 * - Background sync (when browser is back online)
 * - Push notifications (if implemented)
 */

declare const self: ServiceWorkerGlobalScope;

// SyncEvent type for background sync API (not in all TypeScript libs)
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

// Extend ServiceWorkerGlobalScope to include sync event
declare global {
  interface ServiceWorkerGlobalScopeEventMap {
    sync: SyncEvent;
  }
}

// Install: Skip waiting to activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Activate: Claim all clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Background sync: Notify SharedWorker to sync when back online
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'sync-pending') {
    event.waitUntil(
      // Notify all clients to trigger sync via SharedWorker
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGERED' });
        });
      })
    );
  }
});

// Push notifications (placeholder for future implementation)
self.addEventListener('push', (event) => {
  // TODO: Implement push notifications if needed
  console.log('[SW] Push event received:', event);
});

export {};
