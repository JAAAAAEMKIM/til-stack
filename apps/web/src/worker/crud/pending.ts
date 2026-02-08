/**
 * Pure functions for managing pending operations queue.
 *
 * This module provides functions for managing the sync_pending table,
 * which stores operations that need to be synced to the server when online.
 */

import type { Database, PendingOperation } from '../types';

/**
 * Add a pending operation to the queue.
 *
 * Deduplication logic:
 * - Entry operations (upsert/delete): dedupe by date
 * - Skip day operations: dedupe by (action, type, value)
 * - Template operations: dedupe by (action, templateId) or (action, name) for creates
 *
 * @param db - The sql.js database instance
 * @param op - The operation to add (without id and createdAt)
 */
export function addPendingOperation(
  db: Database,
  op: Omit<PendingOperation, 'id' | 'createdAt'>
): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Dedupe logic to prevent duplicate pending operations
  if (op.type === 'upsert' || op.type === 'delete') {
    // Entry operations: dedupe by date
    db.run(`DELETE FROM sync_pending WHERE date = ?`, [op.date]);
  } else if (op.type === 'skip_day' && op.payload) {
    // Skip day operations: dedupe by (action, type, value)
    const payload = JSON.parse(op.payload);
    const existing = db.exec(
      `SELECT id, payload FROM sync_pending WHERE type = 'skip_day'`
    );
    if (existing[0]?.values) {
      for (const [existingId, existingPayload] of existing[0].values) {
        try {
          const p = JSON.parse(existingPayload as string);
          if (p.action === payload.action && p.type === payload.type && p.value === payload.value) {
            db.run(`DELETE FROM sync_pending WHERE id = ?`, [existingId]);
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }
  } else if (op.type === 'template' && op.payload) {
    // Template operations: dedupe by (action, id) for updates/deletes, (action, name) for creates
    const payload = JSON.parse(op.payload);
    const existing = db.exec(
      `SELECT id, payload FROM sync_pending WHERE type = 'template'`
    );
    if (existing[0]?.values) {
      for (const [existingId, existingPayload] of existing[0].values) {
        try {
          const p = JSON.parse(existingPayload as string);
          const shouldDelete =
            (payload.action === 'create' && p.action === 'create' && p.name === payload.name) ||
            (payload.action !== 'create' && p.action === payload.action && p.id === payload.id);
          if (shouldDelete) {
            db.run(`DELETE FROM sync_pending WHERE id = ?`, [existingId]);
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }
  } else if (op.type === 'webhook' && op.payload) {
    // Webhook operations: dedupe by (action, webhook.id) for updates/deletes, (action, webhook.name) for creates
    const payload = JSON.parse(op.payload);
    const existing = db.exec(
      `SELECT id, payload FROM sync_pending WHERE type = 'webhook'`
    );
    if (existing[0]?.values) {
      for (const [existingId, existingPayload] of existing[0].values) {
        try {
          const p = JSON.parse(existingPayload as string);
          const shouldDelete =
            (payload.action === 'create' && p.action === 'create' && p.webhook?.name === payload.webhook?.name) ||
            (payload.action === 'update' && p.action === 'update' && p.webhook?.id === payload.webhook?.id) ||
            (payload.action === 'delete' && p.action === 'delete' && p.webhookId === payload.webhookId);
          if (shouldDelete) {
            db.run(`DELETE FROM sync_pending WHERE id = ?`, [existingId]);
          }
        } catch {
          // Invalid JSON, skip
        }
      }
    }
  }

  db.run(
    `INSERT INTO sync_pending (id, type, date, content, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, op.type, op.date ?? null, op.content ?? null, op.payload ?? null, now]
  );
}

/**
 * Get all pending operations ordered by creation time.
 *
 * @param db - The sql.js database instance
 * @returns Array of pending operations
 */
export function getPendingOperations(db: Database): PendingOperation[] {
  const results = db.exec(`SELECT * FROM sync_pending ORDER BY created_at ASC`);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    type: row[1] as PendingOperation['type'],
    date: row[2] as string,
    content: row[3] as string | undefined,
    payload: row[4] as string | undefined,
    createdAt: row[5] as string,
  })) || [];
}

/**
 * Clear a specific pending operation by ID.
 *
 * @param db - The sql.js database instance
 * @param id - The operation ID to clear
 */
export function clearPendingOperation(db: Database, id: string): void {
  db.run(`DELETE FROM sync_pending WHERE id = ?`, [id]);
}

/**
 * Clear all pending operations.
 *
 * @param db - The sql.js database instance
 */
export function clearAllPendingOperations(db: Database): void {
  db.run(`DELETE FROM sync_pending`);
}

/**
 * Get count of pending operations.
 *
 * @param db - The sql.js database instance
 * @returns Number of pending operations
 */
export function getPendingOperationCount(db: Database): number {
  const results = db.exec(`SELECT COUNT(*) FROM sync_pending`);
  return results[0]?.values[0]?.[0] as number || 0;
}

/**
 * Check if there are any pending operations.
 *
 * @param db - The sql.js database instance
 * @returns True if there are pending operations, false otherwise
 */
export function hasPendingOperations(db: Database): boolean {
  return getPendingOperationCount(db) > 0;
}
