import { router, publicProcedure } from "./trpc.js";
import {
  addSkipWeekdaySchema,
  addSkipDateSchema,
  removeSkipDaySchema,
  createTemplateSchema,
  updateTemplateSchema,
  deleteTemplateSchema,
  setDefaultTemplateSchema,
} from "@til-stack/shared";
import { db, schema } from "../db/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

// Helper to create user filter condition for skipDays (handles null userId for anonymous users)
function skipDaysUserFilter(userId: string | null | undefined) {
  return userId ? eq(schema.skipDays.userId, userId) : isNull(schema.skipDays.userId);
}

// Helper to create user filter condition for templates (handles null userId for anonymous users)
function templatesUserFilter(userId: string | null | undefined) {
  return userId ? eq(schema.templates.userId, userId) : isNull(schema.templates.userId);
}

export const configRouter = router({
  // === Skip Days ===
  getSkipDays: publicProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id ?? null;
    const skipDays = await db
      .select()
      .from(schema.skipDays)
      .where(skipDaysUserFilter(userId))
      .all();

    const weekdays = skipDays
      .filter((s) => s.type === "weekday")
      .map((s) => parseInt(s.value));

    const specificDates = skipDays
      .filter((s) => s.type === "specific_date")
      .map((s) => s.value);

    return { weekdays, specificDates, raw: skipDays };
  }),

  addSkipWeekday: publicProcedure
    .input(addSkipWeekdaySchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      const existing = await db
        .select()
        .from(schema.skipDays)
        .where(
          and(
            eq(schema.skipDays.type, "weekday"),
            eq(schema.skipDays.value, input.weekday.toString()),
            skipDaysUserFilter(userId)
          )
        )
        .get();

      if (existing) return existing;

      return await db
        .insert(schema.skipDays)
        .values({
          id: nanoid(),
          type: "weekday",
          value: input.weekday.toString(),
          userId,
        })
        .returning()
        .get();
    }),

  addSkipDate: publicProcedure
    .input(addSkipDateSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      const existing = await db
        .select()
        .from(schema.skipDays)
        .where(
          and(
            eq(schema.skipDays.type, "specific_date"),
            eq(schema.skipDays.value, input.date),
            skipDaysUserFilter(userId)
          )
        )
        .get();

      if (existing) return existing;

      return await db
        .insert(schema.skipDays)
        .values({
          id: nanoid(),
          type: "specific_date",
          value: input.date,
          userId,
        })
        .returning()
        .get();
    }),

  removeSkipDay: publicProcedure
    .input(removeSkipDaySchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      await db
        .delete(schema.skipDays)
        .where(
          and(
            eq(schema.skipDays.id, input.id),
            skipDaysUserFilter(userId)
          )
        );
      return { success: true };
    }),

  // === Templates ===
  getTemplates: publicProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id ?? null;
    return await db
      .select()
      .from(schema.templates)
      .where(templatesUserFilter(userId))
      .all();
  }),

  getDefaultTemplate: publicProcedure.query(async ({ ctx }) => {
    const userId = ctx.user?.id ?? null;
    return (
      (await db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.isDefault, true),
            templatesUserFilter(userId)
          )
        )
        .get()) ?? null
    );
  }),

  createTemplate: publicProcedure
    .input(createTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      return await db
        .insert(schema.templates)
        .values({
          id: nanoid(),
          name: input.name,
          content: input.content,
          isDefault: false,
          userId,
        })
        .returning()
        .get();
    }),

  updateTemplate: publicProcedure
    .input(updateTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      const { id, ...updates } = input;
      return await db
        .update(schema.templates)
        .set({
          ...updates,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(schema.templates.id, id),
            templatesUserFilter(userId)
          )
        )
        .returning()
        .get();
    }),

  deleteTemplate: publicProcedure
    .input(deleteTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      await db
        .delete(schema.templates)
        .where(
          and(
            eq(schema.templates.id, input.id),
            templatesUserFilter(userId)
          )
        );
      return { success: true };
    }),

  setDefaultTemplate: publicProcedure
    .input(setDefaultTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user?.id ?? null;
      // First, unset all defaults for this user
      await db
        .update(schema.templates)
        .set({ isDefault: false, updatedAt: new Date().toISOString() })
        .where(templatesUserFilter(userId));

      // If an ID is provided, set that template as default (only if owned by user)
      if (input.id) {
        await db
          .update(schema.templates)
          .set({ isDefault: true, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(schema.templates.id, input.id),
              templatesUserFilter(userId)
            )
          );
      }

      return { success: true };
    }),
});
