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
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export const configRouter = router({
  // === Skip Days ===
  getSkipDays: publicProcedure.query(async () => {
    const skipDays = await db.select().from(schema.skipDays).all();

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
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(schema.skipDays)
        .where(
          and(
            eq(schema.skipDays.type, "weekday"),
            eq(schema.skipDays.value, input.weekday.toString())
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
        })
        .returning()
        .get();
    }),

  addSkipDate: publicProcedure
    .input(addSkipDateSchema)
    .mutation(async ({ input }) => {
      const existing = await db
        .select()
        .from(schema.skipDays)
        .where(
          and(
            eq(schema.skipDays.type, "specific_date"),
            eq(schema.skipDays.value, input.date)
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
        })
        .returning()
        .get();
    }),

  removeSkipDay: publicProcedure
    .input(removeSkipDaySchema)
    .mutation(async ({ input }) => {
      await db.delete(schema.skipDays).where(eq(schema.skipDays.id, input.id));
      return { success: true };
    }),

  // === Templates ===
  getTemplates: publicProcedure.query(async () => {
    return await db.select().from(schema.templates).all();
  }),

  getDefaultTemplate: publicProcedure.query(async () => {
    return (
      (await db
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.isDefault, true))
        .get()) ?? null
    );
  }),

  createTemplate: publicProcedure
    .input(createTemplateSchema)
    .mutation(async ({ input }) => {
      return await db
        .insert(schema.templates)
        .values({
          id: nanoid(),
          name: input.name,
          content: input.content,
          isDefault: false,
        })
        .returning()
        .get();
    }),

  updateTemplate: publicProcedure
    .input(updateTemplateSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      return await db
        .update(schema.templates)
        .set({
          ...updates,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.templates.id, id))
        .returning()
        .get();
    }),

  deleteTemplate: publicProcedure
    .input(deleteTemplateSchema)
    .mutation(async ({ input }) => {
      await db
        .delete(schema.templates)
        .where(eq(schema.templates.id, input.id));
      return { success: true };
    }),

  setDefaultTemplate: publicProcedure
    .input(setDefaultTemplateSchema)
    .mutation(async ({ input }) => {
      // First, unset all defaults
      await db
        .update(schema.templates)
        .set({ isDefault: false, updatedAt: new Date().toISOString() });

      // If an ID is provided, set that template as default
      if (input.id) {
        await db
          .update(schema.templates)
          .set({ isDefault: true, updatedAt: new Date().toISOString() })
          .where(eq(schema.templates.id, input.id));
      }

      return { success: true };
    }),
});
