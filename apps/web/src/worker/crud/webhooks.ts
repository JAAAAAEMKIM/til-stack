/**
 * Pure CRUD functions for webhooks
 * Follows the pattern from config.ts
 *
 * NO sync logic - just database operations
 */

import type { Database } from '../types';

// ===== Webhooks =====

export interface Webhook {
  id: string;
  name: string;
  url: string;
  message: string;
  time: string; // HH:MM format
  days: string[]; // ['mon', 'tue', etc]
  timezone: string;
  enabled: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  message?: string;
  time: string;
  days: string[];
  timezone?: string;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  message?: string;
  time?: string;
  days?: string[];
  timezone?: string;
  enabled?: boolean;
}

const MAX_WEBHOOKS = 5;

/**
 * Get all webhooks for a user
 */
export function getWebhooks(db: Database, userId: string): Webhook[] {
  const results = db.exec(`SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at`, [userId]);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    name: row[1] as string,
    url: row[2] as string,
    message: row[3] as string,
    time: row[4] as string,
    days: JSON.parse(row[5] as string) as string[],
    timezone: row[6] as string,
    enabled: Boolean(row[7]),
    userId: row[8] as string,
    createdAt: row[9] as string,
    updatedAt: row[10] as string,
  })) || [];
}

/**
 * Get a specific webhook by ID
 */
export function getWebhookById(db: Database, userId: string, id: string): Webhook | null {
  const results = db.exec(`SELECT * FROM webhooks WHERE id = ? AND user_id = ?`, [id, userId]);
  if (results[0]?.values[0]) {
    const row = results[0].values[0];
    return {
      id: row[0] as string,
      name: row[1] as string,
      url: row[2] as string,
      message: row[3] as string,
      time: row[4] as string,
      days: JSON.parse(row[5] as string) as string[],
      timezone: row[6] as string,
      enabled: Boolean(row[7]),
      userId: row[8] as string,
      createdAt: row[9] as string,
      updatedAt: row[10] as string,
    };
  }
  return null;
}

/**
 * Create a new webhook
 * Enforces MAX_WEBHOOKS limit
 */
export function createWebhook(db: Database, userId: string, input: CreateWebhookInput): Webhook {
  // Check webhook limit
  const countResults = db.exec(`SELECT COUNT(*) FROM webhooks WHERE user_id = ?`, [userId]);
  const count = countResults[0]?.values[0]?.[0] as number;
  if (count >= MAX_WEBHOOKS) {
    throw new Error(`Maximum ${MAX_WEBHOOKS} webhooks allowed`);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const message = input.message || '⏰ Time to write your TIL!';
  const timezone = input.timezone || 'UTC';
  const daysJson = JSON.stringify(input.days);

  db.run(
    `INSERT INTO webhooks (id, name, url, message, time, days, timezone, enabled, user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [id, input.name, input.url, message, input.time, daysJson, timezone, userId, now, now]
  );

  return {
    id,
    name: input.name,
    url: input.url,
    message,
    time: input.time,
    days: input.days,
    timezone,
    enabled: true,
    userId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing webhook
 */
export function updateWebhook(
  db: Database,
  userId: string,
  id: string,
  updates: UpdateWebhookInput
): Webhook | null {
  const now = new Date().toISOString();

  // Build update query dynamically
  const updateParts: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    updateParts.push('name = ?');
    params.push(updates.name);
  }
  if (updates.url !== undefined) {
    updateParts.push('url = ?');
    params.push(updates.url);
  }
  if (updates.message !== undefined) {
    updateParts.push('message = ?');
    params.push(updates.message);
  }
  if (updates.time !== undefined) {
    updateParts.push('time = ?');
    params.push(updates.time);
  }
  if (updates.days !== undefined) {
    updateParts.push('days = ?');
    params.push(JSON.stringify(updates.days));
  }
  if (updates.timezone !== undefined) {
    updateParts.push('timezone = ?');
    params.push(updates.timezone);
  }
  if (updates.enabled !== undefined) {
    updateParts.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }

  if (updateParts.length === 0) {
    // No updates, just return existing webhook
    return getWebhookById(db, userId, id);
  }

  updateParts.push('updated_at = ?');
  params.push(now);

  // Add WHERE clause params
  params.push(id);
  params.push(userId);

  const sql = `UPDATE webhooks SET ${updateParts.join(', ')} WHERE id = ? AND user_id = ?`;
  db.run(sql, params);

  return getWebhookById(db, userId, id);
}

/**
 * Delete a webhook
 */
export function deleteWebhook(db: Database, userId: string, id: string): boolean {
  db.run(`DELETE FROM webhooks WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}
