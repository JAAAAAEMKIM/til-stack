/**
 * Shared types for service worker refactoring
 *
 * This file contains all shared types used across the service worker modules.
 * Organization:
 * - Database types
 * - Sync/Entry types
 * - Session state machine types
 * - Pending operation types
 * - Service worker context types
 */

// ====== DATABASE TYPES ======

/**
 * sql.js Database interface
 */
export interface Database {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string, params?: unknown[]): { columns: string[]; values: unknown[][] }[];
  export(): Uint8Array;
  close(): void;
}

// ====== SYNC/ENTRY TYPES ======

/**
 * Entry type for sync operations
 */
export interface SyncEntry {
  id: string;
  date: string;
  content: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null; // Tombstone for soft delete
}

/**
 * Skip day type for sync
 */
export interface SyncSkipDay {
  id: string;
  type: "weekday" | "specific_date";
  value: string;
  userId: string | null;
  createdAt: string;
}

/**
 * Template type for sync
 */
export interface SyncTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * User preferences type for sync
 */
export interface SyncPreferences {
  id: string;
  userId: string;
  aiConfig: string | null;
  theme: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Webhook type for sync
 */
export interface SyncWebhook {
  id: string;
  name: string;
  url: string;
  message: string;
  time: string;
  days: string[];
  timezone: string;
  enabled: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// ====== SESSION STATE MACHINE TYPES ======

/**
 * Session state for the state machine
 */
export type SessionState = 'ANONYMOUS' | 'SWITCHING' | 'AUTHENTICATED';

/**
 * Session event types for state transitions
 */
export type SessionEventType =
  | 'LOGIN_STARTED'
  | 'LOGIN_COMPLETED'
  | 'LOGOUT_STARTED'
  | 'LOGOUT_COMPLETED'
  | 'SWITCH_USER'
  | 'SYNC_STARTED'
  | 'SYNC_COMPLETED'
  | 'SYNC_FAILED';

/**
 * Session event for state machine
 */
export interface SessionEvent {
  type: SessionEventType;
  userId?: string | null;
  isNewUser?: boolean;
  mergeAnonymous?: boolean;
}

// ====== PENDING OPERATION TYPES ======

/**
 * Pending operation (queued when offline)
 */
export type PendingOperation = {
  id: string;
  type: "upsert" | "delete" | "skip_day" | "template" | "webhook";
  date: string;
  content?: string;
  payload?: string; // JSON payload for config operations
  createdAt: string;
};

// ====== SERVICE WORKER CONTEXT TYPES ======

/**
 * Service worker context interface
 * Provides global state and utilities to all modules
 */
export interface ServiceWorkerContext {
  readonly apiUrl: string;
  debug: {
    enabled: boolean;
    log: (category: string, message: string, ...args: unknown[]) => void;
    setEnabled: (enabled: boolean, categories?: string[]) => void;
  };
  events: {
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (data?: unknown) => void) => void;
    off: (event: string, handler: (data?: unknown) => void) => void;
  };
}

// ====== MESSAGE TYPES (for service worker communication) ======

/**
 * User login message payload
 */
export interface UserLoginMessage {
  type: 'USER_LOGIN';
  userId: string;
  isNewUser: boolean;
  mergeAnonymous?: boolean;
}

/**
 * User logged in notification (existing session on page load)
 */
export interface UserLoggedInMessage {
  type: 'USER_LOGGED_IN';
  userId: string;
}

/**
 * User logout message
 */
export interface UserLogoutMessage {
  type: 'USER_LOGGED_OUT';
}

/**
 * Anonymous user initialization (ensures database is ready for anonymous usage)
 * This bypasses the session state machine and directly initializes the database.
 */
export interface UserAnonymousMessage {
  type: 'USER_ANONYMOUS';
}

/**
 * Manual sync trigger
 */
export interface SyncNowMessage {
  type: 'SYNC_NOW';
}

/**
 * Clear local data message
 */
export interface ClearLocalDataMessage {
  type: 'CLEAR_LOCAL_DATA';
}

/**
 * Debug state request
 */
export interface DebugStateMessage {
  type: 'DEBUG_STATE';
}

/**
 * Check pending sync status
 */
export interface CheckPendingSyncMessage {
  type: 'CHECK_PENDING_SYNC';
}

/**
 * Retry pending operations
 */
export interface RetrySyncMessage {
  type: 'RETRY_SYNC';
}

/**
 * Set online status
 */
export interface SetOnlineStatusMessage {
  type: 'SET_ONLINE_STATUS';
  online: boolean;
}

/**
 * Check if user has data
 */
export interface CheckUserDataMessage {
  type: 'CHECK_USER_DATA';
  userId: string;
}

/**
 * Update entry from server (sync pull)
 */
export interface UpdateEntryMessage {
  type: 'UPDATE_ENTRY';
  entry: SyncEntry;
}

/**
 * Export data for migration
 */
export interface ExportDataMessage {
  type: 'EXPORT_DATA';
}

/**
 * Union of all message types
 */
export type ServiceWorkerMessage =
  | UserLoginMessage
  | UserLoggedInMessage
  | UserLogoutMessage
  | UserAnonymousMessage
  | SyncNowMessage
  | ClearLocalDataMessage
  | DebugStateMessage
  | CheckPendingSyncMessage
  | RetrySyncMessage
  | SetOnlineStatusMessage
  | CheckUserDataMessage
  | UpdateEntryMessage
  | ExportDataMessage;

// ====== SYNC RESULT TYPES ======

/**
 * Full sync result
 */
export interface FullSyncResult {
  pushed: number;
  pulled: number;
  pendingSynced: number;
}

/**
 * Pending operations result
 */
export interface PendingOperationsResult {
  synced: number;
  failed: number;
}

/**
 * User login result
 */
export interface UserLoginResult {
  migrated: boolean;
  merged: boolean;
  pulled: number;
  mergedEntries: number;
}

// ====== INTERNAL STATE TYPES ======

/**
 * Last sync result (for debugging)
 */
export interface LastSyncResult {
  action: string;
  pulled?: number;
  pushed?: number;
  error?: string;
  timestamp: string;
}

/**
 * Last login info (for debugging)
 */
export interface LastLoginInfo {
  isNewUser?: boolean;
  migrated?: boolean;
  syncCalled?: boolean;
  timestamp: string;
}

/**
 * Last database load info (for debugging)
 */
export interface LastDbLoadInfo {
  loadKey: string | null;
  actualStorageKey: string;
  persistenceLastLoadKey: string | null;
  loadedBytes: number | null;
  verifyLoadedBytes: number | null;
  currentUserId: string | null;
  version: number;
  timestamp: string;
}

/**
 * Last clear info (for debugging)
 */
export interface LastClearInfo {
  clearedKey: string | null;
  timestamp: string;
}

// ====== SHARED WORKER TYPES ======

/**
 * tRPC request via MessagePort
 */
export interface TRPCPortRequest {
  type: 'TRPC_REQUEST';
  id: string;
  method: 'query' | 'mutation';
  path: string;
  input: unknown;
}

/**
 * tRPC response via MessagePort
 */
export interface TRPCPortResponse {
  id: string;
  result?: unknown;
  error?: { message: string };
}

/**
 * Control message via MessagePort (login, sync, etc.)
 */
export interface ControlPortMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Union of all MessagePort message types
 */
export type PortMessage = TRPCPortRequest | ControlPortMessage;
