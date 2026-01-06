import { z } from "zod";

// Date format: YYYY-MM-DD with validity check
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (dateStr) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  },
  { message: "Invalid date" }
);

export const createEntrySchema = z.object({
  date: dateSchema,
  content: z.string().min(1),
});

export const updateEntrySchema = z.object({
  date: dateSchema,
  content: z.string().min(1),
});

export const upsertEntrySchema = z.object({
  date: dateSchema,
  content: z.string().min(1),
});

export const getByDateSchema = z.object({
  date: dateSchema,
});

export const getByDateRangeSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
});

export const deleteEntrySchema = z.object({
  date: dateSchema,
});

export const listEntriesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().min(1).max(50).default(20),
});

export const weeklyInputSchema = z.object({
  weekStart: dateSchema, // Monday of the week
});

export const monthlyInputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM format
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type UpsertEntryInput = z.infer<typeof upsertEntrySchema>;
export type GetByDateInput = z.infer<typeof getByDateSchema>;
export type GetByDateRangeInput = z.infer<typeof getByDateRangeSchema>;
export type DeleteEntryInput = z.infer<typeof deleteEntrySchema>;
export type ListEntriesInput = z.infer<typeof listEntriesSchema>;
export type WeeklyInput = z.infer<typeof weeklyInputSchema>;
export type MonthlyInput = z.infer<typeof monthlyInputSchema>;
