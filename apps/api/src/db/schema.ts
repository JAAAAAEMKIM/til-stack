import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
