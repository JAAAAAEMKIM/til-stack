import cron, { type ScheduledTask } from "node-cron";
import type { DayOfWeek } from "@til-stack/shared";

// Map of webhook ID to scheduled task
const scheduledJobs = new Map<string, ScheduledTask>();

// Day of week mapping for cron (0 = Sunday)
const dayToCron: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  message: string;
  time: string; // HH:MM
  days: DayOfWeek[];
  timezone: string;
  enabled: boolean;
}

/**
 * Build a cron expression from time and days
 * Format: minute hour * * days
 */
function buildCronExpression(time: string, days: DayOfWeek[]): string {
  const [hour, minute] = time.split(":");
  const cronDays = days.map((d) => dayToCron[d]).join(",");
  return `${parseInt(minute)} ${parseInt(hour)} * * ${cronDays}`;
}

/**
 * Send a webhook notification
 */
async function sendWebhook(webhook: WebhookConfig): Promise<boolean> {
  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Slack format
        text: webhook.message,
        username: "TIL Reminder",
        // Discord format
        content: webhook.message,
      }),
    });

    if (!response.ok) {
      console.error(
        `[Webhook] Failed to send to ${webhook.name}: ${response.status} ${response.statusText}`
      );
      return false;
    }

    console.log(`[Webhook] Successfully sent to ${webhook.name}`);
    return true;
  } catch (error) {
    console.error(`[Webhook] Error sending to ${webhook.name}:`, error);
    return false;
  }
}

/**
 * Schedule a webhook job
 */
export function scheduleWebhook(webhook: WebhookConfig): void {
  // Cancel existing job if any
  cancelWebhook(webhook.id);

  if (!webhook.enabled) {
    console.log(`[Webhook] Skipping disabled webhook: ${webhook.name}`);
    return;
  }

  const cronExpression = buildCronExpression(webhook.time, webhook.days);
  console.log(
    `[Webhook] Scheduling ${webhook.name}: ${cronExpression} (${webhook.timezone})`
  );

  const task = cron.schedule(
    cronExpression,
    async () => {
      console.log(`[Webhook] Triggering: ${webhook.name}`);
      await sendWebhook(webhook);
    },
    {
      timezone: webhook.timezone,
    }
  );

  scheduledJobs.set(webhook.id, task);
}

/**
 * Cancel a scheduled webhook job
 */
export function cancelWebhook(webhookId: string): void {
  const task = scheduledJobs.get(webhookId);
  if (task) {
    task.stop();
    scheduledJobs.delete(webhookId);
    console.log(`[Webhook] Cancelled job: ${webhookId}`);
  }
}

/**
 * Schedule all webhooks from the database
 * Call this on server startup
 */
export function scheduleAllWebhooks(webhooks: WebhookConfig[]): void {
  // Clear all existing jobs first
  for (const [id, task] of scheduledJobs) {
    task.stop();
    console.log(`[Webhook] Stopped existing job: ${id}`);
  }
  scheduledJobs.clear();

  // Schedule all enabled webhooks
  for (const webhook of webhooks) {
    scheduleWebhook(webhook);
  }

  console.log(
    `[Webhook] Initialized ${scheduledJobs.size} jobs from ${webhooks.length} webhooks`
  );
}

/**
 * Get the count of active scheduled jobs
 */
export function getScheduledJobCount(): number {
  return scheduledJobs.size;
}

/**
 * Test a webhook by sending immediately
 */
export async function testWebhook(webhook: WebhookConfig): Promise<boolean> {
  console.log(`[Webhook] Testing: ${webhook.name}`);
  return sendWebhook(webhook);
}
