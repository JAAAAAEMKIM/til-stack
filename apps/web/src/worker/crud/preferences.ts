/**
 * Pure CRUD functions for user preferences (AI config, theme)
 *
 * Supports both authenticated and anonymous users:
 * - Authenticated users: userId from auth
 * - Anonymous users: __anonymous__ sentinel value
 */

import type { Database } from '../types';

/** Sentinel value for anonymous user preferences */
export const ANONYMOUS_USER_ID = '__anonymous__';

export interface UserPreferences {
  id: string;
  userId: string;
  aiConfig: string | null; // JSON string
  theme: string | null; // "system" | "light" | "dark"
  createdAt: string;
  updatedAt: string;
}

/**
 * Get preferences for a user
 * Returns null if no preferences found
 * @param userId - User ID or null for anonymous users
 */
export function getPreferences(db: Database, userId: string | null): UserPreferences | null {
  const effectiveUserId = userId ?? ANONYMOUS_USER_ID;
  const results = db.exec(
    `SELECT id, user_id, ai_config, theme, created_at, updated_at
     FROM user_preferences
     WHERE user_id = ?`,
    [effectiveUserId]
  );

  if (!results[0]?.values[0]) {
    return null;
  }

  const row = results[0].values[0];
  return {
    id: row[0] as string,
    userId: row[1] as string,
    aiConfig: row[2] as string | null,
    theme: row[3] as string | null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  };
}

/**
 * Set preferences for a user
 * Creates or updates the preferences row
 * @param userId - User ID or null for anonymous users
 */
export function setPreferences(
  db: Database,
  userId: string | null,
  updates: { aiConfig?: string; theme?: string }
): UserPreferences {
  const effectiveUserId = userId ?? ANONYMOUS_USER_ID;
  const existing = getPreferences(db, userId);
  const now = new Date().toISOString();

  if (existing) {
    // Update existing
    if (updates.aiConfig !== undefined) {
      db.run(
        `UPDATE user_preferences SET ai_config = ?, updated_at = ? WHERE user_id = ?`,
        [updates.aiConfig, now, effectiveUserId]
      );
    }
    if (updates.theme !== undefined) {
      db.run(
        `UPDATE user_preferences SET theme = ?, updated_at = ? WHERE user_id = ?`,
        [updates.theme, now, effectiveUserId]
      );
    }

    return getPreferences(db, userId)!;
  } else {
    // Create new
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO user_preferences (id, user_id, ai_config, theme, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, effectiveUserId, updates.aiConfig ?? null, updates.theme ?? null, now, now]
    );

    return {
      id,
      userId: effectiveUserId,
      aiConfig: updates.aiConfig ?? null,
      theme: updates.theme ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }
}
