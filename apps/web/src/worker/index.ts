/**
 * Service Worker Module Composition
 *
 * This file composes all service worker modules and exports handlers for use in service-worker.ts.
 * It instantiates managers and handlers in the correct dependency order and wires up event-based communication.
 */

import { createServiceWorkerContext } from './context';
import { DatabaseManager } from './database';
import { SessionManager } from './session';
import { SyncOrchestrator } from './sync/orchestrator';
import { RequestHandler } from './handlers/request';
import type { RequestHandlerConfig } from './handlers/request';
import { MessageHandler } from './handlers/message';
import { FetchHandler } from './handlers/fetch';
import type { FetchHandlerConfig } from './handlers/fetch';
import { LifecycleHandler } from './handlers/lifecycle';

// ====== Create Shared Context ======

export const ctx = createServiceWorkerContext();

// ====== Instantiate Managers in Dependency Order ======

// 1. DatabaseManager - manages SQLite database lifecycle
export const databaseManager = new DatabaseManager(ctx);

// 2. SessionManager - manages session state machine
export const sessionManager = new SessionManager(ctx, databaseManager);

// 3. SyncOrchestrator - manages bidirectional sync with server
export const syncOrchestrator = new SyncOrchestrator(ctx, databaseManager, ctx.apiUrl);

// ====== Create Handlers ======

// RequestHandler config - provides access to current session state
const requestHandlerConfig: RequestHandlerConfig = {
  getCurrentUserId: () => sessionManager.getUserId(),
  getOnlineStatus: () => syncOrchestrator.getOnlineStatus(),
  registerBackgroundSync: () => lifecycleHandler.registerBackgroundSync().then(() => {}),
};

// 4. RequestHandler - routes tRPC requests to CRUD operations
export const requestHandler = new RequestHandler(
  ctx,
  databaseManager,
  syncOrchestrator,
  requestHandlerConfig
);

// 5. MessageHandler - processes service worker messages
export const messageHandler = new MessageHandler(
  ctx,
  sessionManager,
  syncOrchestrator,
  databaseManager
);

// FetchHandler config - provides access to current session state for user isolation
const fetchHandlerConfig: FetchHandlerConfig = {
  getCurrentUserId: () => sessionManager.getUserId(),
};

// 6. FetchHandler - handles fetch events for local-first tRPC
export const fetchHandler = new FetchHandler(ctx, requestHandler, fetchHandlerConfig);

// 7. LifecycleHandler - manages install/activate/sync events
export const lifecycleHandler = new LifecycleHandler(
  ctx,
  databaseManager,
  syncOrchestrator
);

// ====== Wire Up Event-Based Communication ======

/**
 * Session to Sync Communication
 *
 * When session state changes (login/logout), notify sync orchestrator
 * to trigger appropriate sync operations.
 */

sessionManager.on('LOGIN_STARTED', async (event) => {
  ctx.debug.log('index', 'Session LOGIN_STARTED, triggering sync handleLogin');
  await syncOrchestrator.handleLogin(event);
});

sessionManager.on('LOGOUT_COMPLETED', async () => {
  ctx.debug.log('index', 'Session LOGOUT_COMPLETED, triggering sync handleLogout');
  await syncOrchestrator.handleLogout();
});

// ====== Re-export Types ======

export type { ServiceWorkerContext, SessionState, SessionEvent } from './types';
export type { Database } from './types';

// ====== Initialization Log ======

ctx.debug.log('index', 'Service worker modules initialized');
