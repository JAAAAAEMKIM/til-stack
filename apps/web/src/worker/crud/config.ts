/**
 * Pure CRUD functions for config (skip days and templates)
 * Extracted from service-worker.ts handleConfig()
 *
 * NO sync logic - just database operations
 */

import type { Database } from '../types';

// ===== Skip Days =====

export interface SkipDay {
  id: string;
  type: 'weekday' | 'specific_date';
  value: string;
  userId: string | null;
  createdAt: string;
}

export interface SkipDaysResult {
  weekdays: number[];
  specificDates: string[];
  raw: SkipDay[];
}

export function getSkipDays(db: Database): SkipDaysResult {
  const results = db.exec(`SELECT * FROM skip_days`);
  const raw: SkipDay[] = results[0]?.values.map((row) => ({
    id: row[0] as string,
    type: row[1] as 'weekday' | 'specific_date',
    value: row[2] as string,
    userId: row[3] as string | null,
    createdAt: row[4] as string,
  })) || [];

  const weekdays = raw
    .filter((s) => s.type === 'weekday')
    .map((s) => parseInt(s.value));

  const specificDates = raw
    .filter((s) => s.type === 'specific_date')
    .map((s) => s.value);

  return { weekdays, specificDates, raw };
}

export function addSkipWeekday(db: Database, weekday: number): SkipDay {
  // Check if already exists
  const existing = db.exec(
    `SELECT * FROM skip_days WHERE type = 'weekday' AND value = ?`,
    [weekday.toString()]
  );

  if (existing[0]?.values[0]) {
    const row = existing[0].values[0];
    return {
      id: row[0] as string,
      type: 'weekday',
      value: row[1] as string,
      userId: row[2] as string | null,
      createdAt: row[3] as string,
    };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO skip_days (id, type, value, created_at) VALUES (?, 'weekday', ?, ?)`,
    [id, weekday.toString(), now]
  );

  return { id, type: 'weekday', value: weekday.toString(), userId: null, createdAt: now };
}

export function addSkipDate(db: Database, date: string): SkipDay {
  // Check if already exists
  const existing = db.exec(
    `SELECT * FROM skip_days WHERE type = 'specific_date' AND value = ?`,
    [date]
  );

  if (existing[0]?.values[0]) {
    const row = existing[0].values[0];
    return {
      id: row[0] as string,
      type: 'specific_date',
      value: row[1] as string,
      userId: row[2] as string | null,
      createdAt: row[3] as string,
    };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO skip_days (id, type, value, created_at) VALUES (?, 'specific_date', ?, ?)`,
    [id, date, now]
  );

  return { id, type: 'specific_date', value: date, userId: null, createdAt: now };
}

export interface SkipDayInfo {
  type: 'weekday' | 'specific_date';
  value: string;
}

export function removeSkipDay(db: Database, id: string): SkipDayInfo | null {
  // Get skip day info before deletion (for sync)
  const skipDayInfo = db.exec(`SELECT type, value FROM skip_days WHERE id = ?`, [id]);
  const skipDayType = skipDayInfo[0]?.values[0]?.[0] as string | undefined;
  const skipDayValue = skipDayInfo[0]?.values[0]?.[1] as string | undefined;

  if (!skipDayType || !skipDayValue) {
    return null;
  }

  db.run(`DELETE FROM skip_days WHERE id = ?`, [id]);

  return {
    type: skipDayType as 'weekday' | 'specific_date',
    value: skipDayValue,
  };
}

// ===== Templates =====

export interface Template {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getTemplates(db: Database): Template[] {
  const results = db.exec(`SELECT * FROM templates ORDER BY name`);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    name: row[1] as string,
    content: row[2] as string,
    isDefault: Boolean(row[3]),
    userId: row[4] as string | null,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  })) || [];
}

export function getDefaultTemplate(db: Database): Template | null {
  const results = db.exec(`SELECT * FROM templates WHERE is_default = 1 LIMIT 1`);
  if (results[0]?.values[0]) {
    const row = results[0].values[0];
    return {
      id: row[0] as string,
      name: row[1] as string,
      content: row[2] as string,
      isDefault: Boolean(row[3]),
      userId: row[4] as string | null,
      createdAt: row[5] as string,
      updatedAt: row[6] as string,
    };
  }
  return null;
}

export function createTemplate(db: Database, template: { name: string; content: string }): Template {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO templates (id, name, content, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    [id, template.name, template.content, now, now]
  );

  return {
    id,
    name: template.name,
    content: template.content,
    isDefault: false,
    userId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTemplate(
  db: Database,
  id: string,
  updates: { name?: string; content?: string }
): Template | null {
  const now = new Date().toISOString();

  if (updates.name !== undefined) {
    db.run(`UPDATE templates SET name = ?, updated_at = ? WHERE id = ?`, [updates.name, now, id]);
  }
  if (updates.content !== undefined) {
    db.run(`UPDATE templates SET content = ?, updated_at = ? WHERE id = ?`, [updates.content, now, id]);
  }

  const result = db.exec(`SELECT * FROM templates WHERE id = ?`, [id]);
  if (result[0]?.values[0]) {
    const row = result[0].values[0];
    return {
      id: row[0] as string,
      name: row[1] as string,
      content: row[2] as string,
      isDefault: Boolean(row[3]),
      userId: row[4] as string | null,
      createdAt: row[5] as string,
      updatedAt: row[6] as string,
    };
  }
  return null;
}

export function deleteTemplate(db: Database, id: string): boolean {
  db.run(`DELETE FROM templates WHERE id = ?`, [id]);
  return true;
}

export function setDefaultTemplate(db: Database, id: string | null): void {
  const now = new Date().toISOString();
  db.run(`UPDATE templates SET is_default = 0, updated_at = ?`, [now]);
  if (id) {
    db.run(`UPDATE templates SET is_default = 1, updated_at = ? WHERE id = ?`, [now, id]);
  }
}
