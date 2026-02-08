/**
 * Pure CRUD functions for entries
 *
 * These functions handle local database operations for entries only.
 * NO sync logic, NO side effects beyond database operations.
 */

import type { Database } from '../types';

export interface Entry {
  id: string;
  date: string;
  content: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListEntriesParams {
  cursor?: string;
  limit?: number;
  excludeDeleted?: boolean;
}

export interface ListEntriesResult {
  items: Entry[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface WeeklySummaryParams {
  weekStart: string;
}

export interface WeeklySummaryResult {
  weekStart: string;
  weekEnd: string;
  entries: Entry[];
  totalEntries: number;
}

export interface MonthlySummaryParams {
  month: string;
}

export interface WeekGroup {
  weekStart: string;
  weekEnd: string;
  entries: Entry[];
}

export interface MonthlySummaryResult {
  month: string;
  entries: Entry[];
  totalEntries: number;
  weeks: WeekGroup[];
}

/**
 * List entries with pagination
 */
export function listEntries(db: Database, params: ListEntriesParams): ListEntriesResult {
  const { cursor, limit = 20 } = params;
  const query = cursor
    ? `SELECT * FROM entries WHERE date < ? ORDER BY date DESC LIMIT ?`
    : `SELECT * FROM entries ORDER BY date DESC LIMIT ?`;
  const queryParams = cursor ? [cursor, limit + 1] : [limit + 1];
  const results = db.exec(query, queryParams);
  const items = results[0]?.values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  })) || [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].date : undefined,
  };
}

/**
 * Get single entry by date
 */
export function getEntryByDate(db: Database, date: string): Entry | null {
  const results = db.exec(`SELECT * FROM entries WHERE date = ?`, [date]);
  if (results[0]?.values[0]) {
    const row = results[0].values[0];
    return {
      id: row[0] as string,
      date: row[1] as string,
      content: row[2] as string,
      userId: (row[3] as string) ?? null,
      createdAt: row[4] as string,
      updatedAt: row[5] as string,
    };
  }
  return null;
}

/**
 * Get entries in date range
 */
export function getEntriesByDateRange(
  db: Database,
  startDate: string,
  endDate: string
): Entry[] {
  const results = db.exec(
    `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [startDate, endDate]
  );
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  })) || [];
}

/**
 * Upsert entry (create or update)
 * Returns the upserted entry
 */
export function upsertEntry(db: Database, entry: { date: string; content: string }): Entry {
  const { date, content } = entry;
  const now = new Date().toISOString();
  const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [date]);
  if (existing[0]?.values[0]) {
    db.run(`UPDATE entries SET content = ?, updated_at = ? WHERE date = ?`, [
      content,
      now,
      date,
    ]);
  } else {
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO entries (id, date, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, date, content, now, now]
    );
  }

  // Return the upserted entry
  const result = db.exec(`SELECT * FROM entries WHERE date = ?`, [date]);
  const row = result[0].values[0];
  return {
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  };
}

/**
 * Delete entry (hard delete)
 * Returns true if entry was deleted
 */
export function deleteEntry(db: Database, date: string): boolean {
  const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [date]);
  if (!existing[0]?.values[0]) {
    return false; // Entry doesn't exist
  }
  db.run(`DELETE FROM entries WHERE date = ?`, [date]);
  return true;
}

/**
 * Get weekly summary data
 */
export function getWeeklySummary(db: Database, params: WeeklySummaryParams): WeeklySummaryResult {
  const { weekStart } = params;
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEndStr = weekEndDate.toISOString().split("T")[0];

  const results = db.exec(
    `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [weekStart, weekEndStr]
  );
  const entries = results[0]?.values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  })) || [];

  return {
    weekStart,
    weekEnd: weekEndStr,
    entries,
    totalEntries: entries.length,
  };
}

/**
 * Get monthly summary data
 */
export function getMonthlySummary(db: Database, params: MonthlySummaryParams): MonthlySummaryResult {
  const { month } = params;
  const [year, monthNum] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const results = db.exec(
    `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
    [startDate, endDate]
  );
  const entries = results[0]?.values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  })) || [];

  // Group entries by week
  const weeks: WeekGroup[] = [];
  const currentWeekStart = new Date(startDate);
  // Adjust to Monday
  const day = currentWeekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  currentWeekStart.setDate(currentWeekStart.getDate() + diff);

  while (currentWeekStart <= new Date(endDate)) {
    const weekEndDate = new Date(currentWeekStart);
    weekEndDate.setDate(weekEndDate.getDate() + 6);

    const weekStartStr = currentWeekStart.toISOString().split("T")[0];
    const weekEndStr = weekEndDate.toISOString().split("T")[0];

    const weekEntries = entries.filter(
      (e) => e.date && e.date >= weekStartStr && e.date <= weekEndStr
    );

    if (weekEntries.length > 0 || (weekStartStr >= startDate && weekStartStr <= endDate)) {
      weeks.push({
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        entries: weekEntries,
      });
    }

    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
  }

  return {
    month,
    entries,
    totalEntries: entries.length,
    weeks,
  };
}

/**
 * Get all local entries (for sync operations)
 */
export function getAllEntries(db: Database): Entry[] {
  const results = db.exec(`SELECT * FROM entries ORDER BY date DESC`);
  return results[0]?.values.map((row) => ({
    id: row[0] as string,
    date: row[1] as string,
    content: row[2] as string,
    userId: (row[3] as string) ?? null,
    createdAt: row[4] as string,
    updatedAt: row[5] as string,
  })) || [];
}
