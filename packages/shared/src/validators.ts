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

// Config validators - Skip days
export const weekdaySchema = z.number().int().min(0).max(6);

export const addSkipWeekdaySchema = z.object({
  weekday: weekdaySchema,
});

export const addSkipDateSchema = z.object({
  date: dateSchema,
});

export const removeSkipDaySchema = z.object({
  id: z.string().min(1),
});

// Config validators - Templates
export const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
});

export const updateTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
});

export const deleteTemplateSchema = z.object({
  id: z.string().min(1),
});

export const setDefaultTemplateSchema = z.object({
  id: z.string().nullable(), // null to unset default
});

// Config types
export type AddSkipWeekdayInput = z.infer<typeof addSkipWeekdaySchema>;
export type AddSkipDateInput = z.infer<typeof addSkipDateSchema>;
export type RemoveSkipDayInput = z.infer<typeof removeSkipDaySchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema>;
export type SetDefaultTemplateInput = z.infer<typeof setDefaultTemplateSchema>;
