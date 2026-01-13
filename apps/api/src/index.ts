import "dotenv/config";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./routes/index.js";
import { db, schema } from "./db/index.js";
import { scheduleAllWebhooks } from "./lib/webhook-scheduler.js";
import type { DayOfWeek } from "@til-stack/shared";

const app = new Hono();

// Initialize webhook scheduler on startup
async function initWebhooks() {
  try {
    const rows = await db.select().from(schema.webhooks).all();
    const webhooks = rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      message: row.message,
      time: row.time,
      days: JSON.parse(row.days) as DayOfWeek[],
      timezone: row.timezone,
      enabled: row.enabled,
    }));
    scheduleAllWebhooks(webhooks);
  } catch (error) {
    console.error("[Webhook] Failed to initialize:", error);
  }
}

initWebhooks();

// CORS configuration from environment
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
app.use(
  "*",
  cors({
    origin: corsOrigin.split(",").map((o) => o.trim()),
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// tRPC handler
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
  })
);

const port = parseInt(process.env.PORT || "3001", 10);

console.log(`API server running on http://localhost:${port}`);
console.log(`CORS origin: ${corsOrigin}`);

serve({
  fetch: app.fetch,
  port,
});

export type { AppRouter } from "./routes/index.js";
