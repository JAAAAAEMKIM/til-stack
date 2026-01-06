import { router, publicProcedure } from "./trpc.js";
import {
  upsertEntrySchema,
  getByDateSchema,
  getByDateRangeSchema,
  deleteEntrySchema,
  listEntriesSchema,
  weeklyInputSchema,
  monthlyInputSchema,
} from "@til-stack/shared";
import { db, schema } from "../db/index.js";
import { eq, desc, lt, and, gte, lte } from "drizzle-orm";
import { nanoid } from "nanoid";

export const entriesRouter = router({
  upsert: publicProcedure.input(upsertEntrySchema).mutation(async ({ input }) => {
    const existing = await db
      .select()
      .from(schema.entries)
      .where(eq(schema.entries.date, input.date))
      .get();

    if (existing) {
      const updated = await db
        .update(schema.entries)
        .set({
          content: input.content,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.entries.date, input.date))
        .returning()
        .get();
      return updated;
    } else {
      const created = await db
        .insert(schema.entries)
        .values({
          id: nanoid(),
          date: input.date,
          content: input.content,
        })
        .returning()
        .get();
      return created;
    }
  }),

  list: publicProcedure.input(listEntriesSchema).query(async ({ input }) => {
    const { cursor, limit } = input;

    const baseQuery = db.select().from(schema.entries);

    const items = cursor
      ? await baseQuery
          .where(lt(schema.entries.date, cursor))
          .orderBy(desc(schema.entries.date))
          .limit(limit + 1)
          .all()
      : await baseQuery
          .orderBy(desc(schema.entries.date))
          .limit(limit + 1)
          .all();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return {
      items,
      hasMore,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].date : undefined,
    };
  }),

  getByDate: publicProcedure.input(getByDateSchema).query(async ({ input }) => {
    const entry = await db
      .select()
      .from(schema.entries)
      .where(eq(schema.entries.date, input.date))
      .get();
    return entry ?? null;
  }),

  getByDateRange: publicProcedure.input(getByDateRangeSchema).query(async ({ input }) => {
    const entries = await db
      .select()
      .from(schema.entries)
      .where(
        and(
          gte(schema.entries.date, input.startDate),
          lte(schema.entries.date, input.endDate)
        )
      )
      .orderBy(desc(schema.entries.date))
      .all();
    return entries;
  }),

  delete: publicProcedure.input(deleteEntrySchema).mutation(async ({ input }) => {
    await db
      .delete(schema.entries)
      .where(eq(schema.entries.date, input.date));
    return { success: true };
  }),

  getWeeklySummary: publicProcedure.input(weeklyInputSchema).query(async ({ input }) => {
    const weekStart = new Date(input.weekStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekEndStr = weekEnd.toISOString().split("T")[0];

    const entries = await db
      .select()
      .from(schema.entries)
      .where(
        and(
          gte(schema.entries.date, input.weekStart),
          lte(schema.entries.date, weekEndStr)
        )
      )
      .orderBy(desc(schema.entries.date))
      .all();

    return {
      weekStart: input.weekStart,
      weekEnd: weekEndStr,
      entries,
      totalEntries: entries.length,
    };
  }),

  getMonthlySummary: publicProcedure.input(monthlyInputSchema).query(async ({ input }) => {
    const [year, month] = input.month.split("-").map(Number);
    const startDate = `${input.month}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${input.month}-${String(lastDay).padStart(2, "0")}`;

    const entries = await db
      .select()
      .from(schema.entries)
      .where(
        and(
          gte(schema.entries.date, startDate),
          lte(schema.entries.date, endDate)
        )
      )
      .orderBy(desc(schema.entries.date))
      .all();

    // Group entries by week
    const weeks: { weekStart: string; weekEnd: string; entries: typeof entries }[] = [];
    let currentWeekStart = new Date(startDate);
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
      month: input.month,
      entries,
      totalEntries: entries.length,
      weeks,
    };
  }),
});
