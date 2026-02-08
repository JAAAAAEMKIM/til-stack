/// <reference lib="webworker" />

import { createSharedWorkerContext } from './worker/shared-worker-context';
import { DatabaseManager } from './worker/database';
import { SessionManager } from './worker/session';
import { SyncOrchestrator } from './worker/sync/orchestrator';
import { RequestHandler } from './worker/handlers/request';
import { MessageHandler } from './worker/handlers/message';
import { PortHandler } from './worker/handlers/port';

// TypeScript type for SharedWorkerGlobalScope
declare const self: SharedWorkerGlobalScope;

// Track connected ports for cleanup
const connectedPorts = new Set<MessagePort>();

// Create context and managers (singleton for all connections)
const ctx = createSharedWorkerContext();
const dbManager = new DatabaseManager(ctx);
const sessionManager = new SessionManager(ctx, dbManager);
const syncOrchestrator = new SyncOrchestrator(ctx, dbManager, ctx.apiUrl);
const requestHandler = new RequestHandler(ctx, dbManager, syncOrchestrator, {
  getCurrentUserId: () => sessionManager.getUserId(),
  getOnlineStatus: () => syncOrchestrator.getOnlineStatus(),
  registerBackgroundSync: () => Promise.resolve(), // No background sync in SharedWorker
});
const messageHandler = new MessageHandler(ctx, sessionManager, syncOrchestrator, dbManager);
const portHandler = new PortHandler(ctx, requestHandler, messageHandler);

// Wire up event-based communication
sessionManager.on('LOGIN_STARTED', async (event) => {
  await syncOrchestrator.handleLogin(event);
});

sessionManager.on('LOGOUT_COMPLETED', async () => {
  await syncOrchestrator.handleLogout();
});

// Handle new connections
self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  ctx.debug.log('shared-worker', `New connection (total: ${connectedPorts.size + 1})`);

  connectedPorts.add(port);

  port.onmessage = (e: MessageEvent) => {
    portHandler.handleMessage(port, e.data);
  };

  // Handle port errors (tab closed, etc.)
  port.onmessageerror = () => {
    ctx.debug.log('shared-worker', 'Port error, removing from tracked ports');
    connectedPorts.delete(port);
  };

  port.start();
};

ctx.debug.log('shared-worker', 'SharedWorker initialized');

export {};
