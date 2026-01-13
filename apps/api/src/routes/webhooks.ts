import { router, publicProcedure } from "./trpc.js";
import {
  createWebhookSchema,
  updateWebhookSchema,
  deleteWebhookSchema,
  testWebhookSchema,
  type DayOfWeek,
} from "@til-stack/shared";
import { db, schema } from "../db/index.js";
import { eq, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  scheduleWebhook,
  cancelWebhook,
  testWebhook,
} from "../lib/webhook-scheduler.js";

// Maximum number of webhooks allowed (to prevent abuse)
const MAX_WEBHOOKS = 5;

// Helper to parse days from DB JSON string
function parseDays(daysJson: string): DayOfWeek[] {
  try {
    return JSON.parse(daysJson) as DayOfWeek[];
  } catch {
    return [];
  }
}

// Helper to convert DB row to webhook config
function toWebhookConfig(row: typeof schema.webhooks.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    message: row.message,
    time: row.time,
    days: parseDays(row.days),
    timezone: row.timezone,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const webhooksRouter = router({
  // List all webhooks
  list: publicProcedure.query(async () => {
    const rows = await db.select().from(schema.webhooks).all();
    return rows.map(toWebhookConfig);
  }),

  // Create a new webhook
  create: publicProcedure
    .input(createWebhookSchema)
    .mutation(async ({ input }) => {
      // Check webhook limit
      const [{ value: webhookCount }] = await db
        .select({ value: count() })
        .from(schema.webhooks);

      if (webhookCount >= MAX_WEBHOOKS) {
        throw new Error(
          `Maximum of ${MAX_WEBHOOKS} webhooks allowed. Please delete an existing webhook first.`
        );
      }

      const id = nanoid();
      const row = await db
        .insert(schema.webhooks)
        .values({
          id,
          name: input.name,
          url: input.url,
          message: input.message,
          time: input.time,
          days: JSON.stringify(input.days),
          timezone: input.timezone,
          enabled: input.enabled,
        })
        .returning()
        .get();

      const webhook = toWebhookConfig(row);

      // Schedule the job
      scheduleWebhook(webhook);

      return webhook;
    }),

  // Update an existing webhook
  update: publicProcedure
    .input(updateWebhookSchema)
    .mutation(async ({ input }) => {
      const { id, days, ...updates } = input;

      const updateData: Record<string, unknown> = {
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      if (days !== undefined) {
        updateData.days = JSON.stringify(days);
      }

      const row = await db
        .update(schema.webhooks)
        .set(updateData)
        .where(eq(schema.webhooks.id, id))
        .returning()
        .get();

      if (!row) {
        throw new Error("Webhook not found");
      }

      const webhook = toWebhookConfig(row);

      // Reschedule the job (cancel + schedule)
      scheduleWebhook(webhook);

      return webhook;
    }),

  // Delete a webhook
  delete: publicProcedure
    .input(deleteWebhookSchema)
    .mutation(async ({ input }) => {
      // Cancel the scheduled job first
      cancelWebhook(input.id);

      await db
        .delete(schema.webhooks)
        .where(eq(schema.webhooks.id, input.id));

      return { success: true };
    }),

  // Test a webhook (send immediately)
  test: publicProcedure
    .input(testWebhookSchema)
    .mutation(async ({ input }) => {
      const row = await db
        .select()
        .from(schema.webhooks)
        .where(eq(schema.webhooks.id, input.id))
        .get();

      if (!row) {
        throw new Error("Webhook not found");
      }

      const webhook = toWebhookConfig(row);
      const success = await testWebhook(webhook);

      return { success };
    }),
});
