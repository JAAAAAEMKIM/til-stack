import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type EntryRow = typeof entries.$inferSelect;
export type InsertEntryRow = typeof entries.$inferInsert;

// Skip days configuration - stores both recurring weekdays and specific dates
export const skipDays = sqliteTable("skip_days", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "weekday" | "specific_date"
  value: text("value").notNull(), // weekday: "0"-"6" (Sun-Sat), specific: "YYYY-MM-DD"
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SkipDayRow = typeof skipDays.$inferSelect;
export type InsertSkipDayRow = typeof skipDays.$inferInsert;

// Templates for new entries
export const templates = sqliteTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type TemplateRow = typeof templates.$inferSelect;
export type InsertTemplateRow = typeof templates.$inferInsert;
