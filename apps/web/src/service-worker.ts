/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

console.log("🚀 Service Worker script loaded!");

import initSqlJs, { type Database } from "sql.js";
import { loadFromIndexedDB, saveToIndexedDB } from "./worker/persistence";

const SW_VERSION = "2026-01-14-v4-wasm-fix";
const CACHE_NAME = "til-stack-v1";
const STATIC_ASSETS = [
  "/sql.js/sql-wasm.wasm",
];

let sqliteDb: Database | null = null;
let isLoggedIn = false;
let syncEnabled = false; // Whether to trigger background sync

// Initialize sql.js and load database
async function initDatabase(): Promise<Database> {
  if (sqliteDb) {
    console.log("[SW] Database already initialized");
    return sqliteDb;
  }

  console.log("[SW] Initializing database...");

  // Try to load wasm from cache first (for offline support)
  let wasmBinary: ArrayBuffer | undefined;
  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match("/sql.js/sql-wasm.wasm");
    if (cachedResponse) {
      console.log("[SW] Loading wasm from cache");
      wasmBinary = await cachedResponse.arrayBuffer();
    }
  } catch (e) {
    console.log("[SW] Cache miss for wasm, will fetch from network");
  }

  const SQL = await initSqlJs({
    locateFile: (file) => {
      console.log("[SW] sql.js locateFile:", file);
      return `/sql.js/${file}`;
    },
    // Pass cached wasm binary if available
    wasmBinary,
  });
  console.log("[SW] sql.js loaded");

  const savedData = await loadFromIndexedDB();
  console.log("[SW] IndexedDB data:", savedData ? `${savedData.length} bytes` : "none");
  sqliteDb = savedData ? new SQL.Database(savedData) : new SQL.Database();

  // Create tables if they don't exist
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skip_days (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      user_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  return sqliteDb;
}

// Persist database to IndexedDB
async function persistDatabase(): Promise<void> {
  if (!sqliteDb) return;
  const data = sqliteDb.export();
  await saveToIndexedDB(data);
}

// Simple tRPC-like request handler for local database
async function handleLocalRequest(
  procedure: string,
  input: unknown
): Promise<unknown> {
  const db = await initDatabase();

  // Parse procedure path (e.g., "entries.list", "config.getSkipDays")
  const [router, method] = procedure.split(".");

  switch (router) {
    case "entries":
      return handleEntries(db, method, input);
    case "config":
      return handleConfig(db, method, input);
    case "webhooks":
      // Webhooks are not available in local mode
      return { error: "Webhooks require login" };
    case "auth":
      // In local-first mode, user is not logged in
      // Return null for auth.me (same as server when not logged in)
      return null;
    default:
      return { error: `Unknown router: ${router}` };
  }
}

async function handleEntries(db: Database, method: string, input: unknown): Promise<unknown> {
  switch (method) {
    case "list": {
      const { cursor, limit = 20 } = (input as { cursor?: string; limit?: number }) || {};
      const query = cursor
        ? `SELECT * FROM entries WHERE date < ? ORDER BY date DESC LIMIT ?`
        : `SELECT * FROM entries ORDER BY date DESC LIMIT ?`;
      const params = cursor ? [cursor, limit + 1] : [limit + 1];
      const results = db.exec(query, params);
      const items = results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];
      const hasMore = items.length > limit;
      if (hasMore) items.pop();
      return {
        items,
        hasMore,
        nextCursor: hasMore && items.length > 0 ? items[items.length - 1].date : undefined,
      };
    }
    case "getByDate": {
      const { date } = input as { date: string };
      const results = db.exec(`SELECT * FROM entries WHERE date = ?`, [date]);
      if (results[0]?.values[0]) {
        const row = results[0].values[0];
        return {
          id: row[0],
          date: row[1],
          content: row[2],
          userId: row[3],
          createdAt: row[4],
          updatedAt: row[5],
        };
      }
      return null;
    }
    case "upsert": {
      const { date, content } = input as { date: string; content: string };
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
      await persistDatabase();
      const result = db.exec(`SELECT * FROM entries WHERE date = ?`, [date]);
      const row = result[0].values[0];
      return {
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      };
    }
    case "delete": {
      const { date } = input as { date: string };
      db.run(`DELETE FROM entries WHERE date = ?`, [date]);
      await persistDatabase();
      return { success: true };
    }
    case "getByDateRange": {
      const { startDate, endDate } = input as { startDate: string; endDate: string };
      const results = db.exec(
        `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
        [startDate, endDate]
      );
      return results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];
    }
    case "getWeeklySummary": {
      const { weekStart } = input as { weekStart: string };
      const weekStartDate = new Date(weekStart);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekEndDate.getDate() + 6);
      const weekEndStr = weekEndDate.toISOString().split("T")[0];

      const results = db.exec(
        `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
        [weekStart, weekEndStr]
      );
      const entries = results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];

      return {
        weekStart,
        weekEnd: weekEndStr,
        entries,
        totalEntries: entries.length,
      };
    }
    case "getMonthlySummary": {
      const { month } = input as { month: string };
      const [year, monthNum] = month.split("-").map(Number);
      const startDate = `${month}-01`;
      const lastDay = new Date(year, monthNum, 0).getDate();
      const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

      const results = db.exec(
        `SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC`,
        [startDate, endDate]
      );
      const entries = results[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];

      // Group entries by week
      interface WeekGroup {
        weekStart: string;
        weekEnd: string;
        entries: typeof entries;
      }
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
          (e) => e.date >= weekStartStr && e.date <= weekEndStr
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
    default:
      return { error: `Unknown method: ${method}` };
  }
}

async function handleConfig(db: Database, method: string, input: unknown): Promise<unknown> {
  switch (method) {
    case "getSkipDays": {
      const results = db.exec(`SELECT * FROM skip_days`);
      const raw = results[0]?.values.map((row) => ({
        id: row[0],
        type: row[1],
        value: row[2],
        userId: row[3],
        createdAt: row[4],
      })) || [];
      const weekdays = raw
        .filter((s) => s.type === "weekday")
        .map((s) => parseInt(s.value as string));
      const specificDates = raw
        .filter((s) => s.type === "specific_date")
        .map((s) => s.value as string);
      return { weekdays, specificDates, raw };
    }
    case "getTemplates": {
      const results = db.exec(`SELECT * FROM templates ORDER BY name`);
      return results[0]?.values.map((row) => ({
        id: row[0],
        name: row[1],
        content: row[2],
        isDefault: Boolean(row[3]),
        userId: row[4],
        createdAt: row[5],
        updatedAt: row[6],
      })) || [];
    }
    case "getDefaultTemplate": {
      const results = db.exec(`SELECT * FROM templates WHERE is_default = 1 LIMIT 1`);
      if (results[0]?.values[0]) {
        const row = results[0].values[0];
        return {
          id: row[0],
          name: row[1],
          content: row[2],
          isDefault: Boolean(row[3]),
          userId: row[4],
          createdAt: row[5],
          updatedAt: row[6],
        };
      }
      return null;
    }
    case "addSkipWeekday": {
      const { weekday } = input as { weekday: number };
      // Check if already exists
      const existing = db.exec(
        `SELECT id FROM skip_days WHERE type = 'weekday' AND value = ?`,
        [weekday.toString()]
      );
      if (existing[0]?.values[0]) {
        const row = existing[0].values[0];
        return { id: row[0], type: "weekday", value: weekday.toString() };
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO skip_days (id, type, value, created_at) VALUES (?, 'weekday', ?, ?)`,
        [id, weekday.toString(), now]
      );
      await persistDatabase();
      return { id, type: "weekday", value: weekday.toString(), createdAt: now };
    }
    case "addSkipDate": {
      const { date } = input as { date: string };
      // Check if already exists
      const existing = db.exec(
        `SELECT id FROM skip_days WHERE type = 'specific_date' AND value = ?`,
        [date]
      );
      if (existing[0]?.values[0]) {
        const row = existing[0].values[0];
        return { id: row[0], type: "specific_date", value: date };
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO skip_days (id, type, value, created_at) VALUES (?, 'specific_date', ?, ?)`,
        [id, date, now]
      );
      await persistDatabase();
      return { id, type: "specific_date", value: date, createdAt: now };
    }
    case "removeSkipDay": {
      const { id } = input as { id: string };
      db.run(`DELETE FROM skip_days WHERE id = ?`, [id]);
      await persistDatabase();
      return { success: true };
    }
    case "createTemplate": {
      const { name, content } = input as { name: string; content: string };
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO templates (id, name, content, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
        [id, name, content, now, now]
      );
      await persistDatabase();
      return { id, name, content, isDefault: false, createdAt: now, updatedAt: now };
    }
    case "updateTemplate": {
      const { id, name, content } = input as { id: string; name?: string; content?: string };
      const now = new Date().toISOString();
      if (name !== undefined) {
        db.run(`UPDATE templates SET name = ?, updated_at = ? WHERE id = ?`, [name, now, id]);
      }
      if (content !== undefined) {
        db.run(`UPDATE templates SET content = ?, updated_at = ? WHERE id = ?`, [content, now, id]);
      }
      await persistDatabase();
      const result = db.exec(`SELECT * FROM templates WHERE id = ?`, [id]);
      if (result[0]?.values[0]) {
        const row = result[0].values[0];
        return {
          id: row[0],
          name: row[1],
          content: row[2],
          isDefault: Boolean(row[3]),
          userId: row[4],
          createdAt: row[5],
          updatedAt: row[6],
        };
      }
      return null;
    }
    case "deleteTemplate": {
      const { id } = input as { id: string };
      db.run(`DELETE FROM templates WHERE id = ?`, [id]);
      await persistDatabase();
      return { success: true };
    }
    case "setDefaultTemplate": {
      const { id } = input as { id: string | null };
      const now = new Date().toISOString();
      // First, unset all defaults
      db.run(`UPDATE templates SET is_default = 0, updated_at = ?`, [now]);
      // If an ID is provided, set that template as default
      if (id) {
        db.run(`UPDATE templates SET is_default = 1, updated_at = ? WHERE id = ?`, [now, id]);
      }
      await persistDatabase();
      return { success: true };
    }
    default:
      return { error: `Unknown method: ${method}` };
  }
}

// Handle tRPC batch requests
async function handleTRPCRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace("/trpc/", "");

  // Handle batch requests
  if (request.method === "GET") {
    // Query batching: ?batch=1&input=...
    const inputParam = url.searchParams.get("input");
    const input = inputParam ? JSON.parse(inputParam) : {};

    // Single query
    if (!pathname.includes(",")) {
      const result = await handleLocalRequest(pathname, input["0"] || input);
      return new Response(
        JSON.stringify({
          result: { data: result },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Batch queries
    const procedures = pathname.split(",");
    const results = await Promise.all(
      procedures.map((proc, i) =>
        handleLocalRequest(proc, input[String(i)] || {})
      )
    );

    return new Response(
      JSON.stringify(results.map((data) => ({ result: { data } }))),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Mutations
  if (request.method === "POST") {
    const body = await request.json();
    const input = body["0"] || body;
    const result = await handleLocalRequest(pathname, input);

    return new Response(
      JSON.stringify({
        result: { data: result },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response("Method not allowed", { status: 405 });
}

// Service Worker event handlers
self.addEventListener("install", (event) => {
  console.log(`[SW] Installing version ${SW_VERSION}...`);
  event.waitUntil(
    Promise.all([
      self.skipWaiting(),
      // Cache static assets needed for offline operation
      caches.open(CACHE_NAME).then((cache) => {
        console.log("[SW] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      }),
    ])
  );
});

self.addEventListener("activate", (event) => {
  console.log(`[SW] Activating version ${SW_VERSION}...`);
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", async (event) => {
  const { type } = event.data;
  if (type === "USER_LOGGED_IN") {
    isLoggedIn = true;
    syncEnabled = true;
    console.log("[SW] User logged in, sync enabled");
  } else if (type === "USER_LOGGED_OUT") {
    isLoggedIn = false;
    syncEnabled = false;
    console.log("[SW] User logged out, sync disabled");
  } else if (type === "UPDATE_ENTRY") {
    // Update local entry from server (for sync pull)
    console.log("[SW] Updating local entry from server");
    try {
      const db = await initDatabase();
      const { entry } = event.data;
      const existing = db.exec(`SELECT id FROM entries WHERE date = ?`, [entry.date]);

      if (existing[0]?.values[0]) {
        db.run(
          `UPDATE entries SET content = ?, updated_at = ?, user_id = ? WHERE date = ?`,
          [entry.content, entry.updatedAt, entry.userId, entry.date]
        );
      } else {
        db.run(
          `INSERT INTO entries (id, date, content, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [entry.id, entry.date, entry.content, entry.userId, entry.createdAt, entry.updatedAt]
        );
      }
      await persistDatabase();
      event.ports[0]?.postMessage({ success: true });
    } catch (error) {
      console.error("[SW] Update entry failed:", error);
      event.ports[0]?.postMessage({ success: false, error: String(error) });
    }
  } else if (type === "EXPORT_DATA") {
    // Export all data for migration
    console.log("[SW] Exporting data for migration");
    try {
      const db = await initDatabase();
      const entries = db.exec(`SELECT * FROM entries`);
      const skipDays = db.exec(`SELECT * FROM skip_days`);
      const templates = db.exec(`SELECT * FROM templates`);

      const entriesList = entries[0]?.values.map((row) => ({
        id: row[0],
        date: row[1],
        content: row[2],
        userId: row[3],
        createdAt: row[4],
        updatedAt: row[5],
      })) || [];

      const skipDaysList = skipDays[0]?.values.map((row) => ({
        id: row[0],
        type: row[1],
        value: row[2],
        userId: row[3],
        createdAt: row[4],
      })) || [];

      const templatesList = templates[0]?.values.map((row) => ({
        id: row[0],
        name: row[1],
        content: row[2],
        isDefault: Boolean(row[3]),
        userId: row[4],
        createdAt: row[5],
        updatedAt: row[6],
      })) || [];

      event.ports[0]?.postMessage({
        entries: entriesList,
        skipDays: skipDaysList,
        templates: templatesList,
      });
    } catch (error) {
      console.error("[SW] Export failed:", error);
      event.ports[0]?.postMessage(null);
    }
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Debug: Log ALL fetch events
  console.log(`[SW ${SW_VERSION}] Fetch event:`, url.pathname);

  // Serve cached static assets (needed for offline sql.js wasm)
  if (STATIC_ASSETS.includes(url.pathname)) {
    console.log("[SW] Serving cached asset:", url.pathname);
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          console.log("[SW] Cache hit:", url.pathname);
          return cached;
        }
        console.log("[SW] Cache miss, fetching:", url.pathname);
        // Fallback to network and cache for future
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Local-first: Always intercept /trpc requests (except pure auth/webhook batches)
  if (url.pathname.startsWith("/trpc")) {
    const procedures = url.pathname.replace("/trpc/", "").split(",");
    console.log("[SW] tRPC procedures:", procedures);

    // Check if ALL procedures are auth or webhooks (need server)
    const allServerOnly = procedures.every(
      (proc) => proc.startsWith("auth.") || proc.startsWith("webhooks.")
    );

    // Only let through if ALL procedures need server
    // Mixed batches are handled locally (auth/webhooks return errors, others work)
    if (allServerOnly) {
      console.log("[SW] All server-only, passing through to network");
      return; // Let it pass through to network
    }

    console.log("[SW] Intercepting:", url.pathname);
    event.respondWith(
      handleTRPCRequest(event.request).catch((err) => {
        console.error("[SW] handleTRPCRequest error:", err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }
  // Other requests (static files, etc.) go to network
  console.log("[SW] Passing through:", url.pathname);
});

export {};
