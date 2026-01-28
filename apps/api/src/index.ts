import "dotenv/config";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./routes/index.js";
import { db, schema } from "./db/index.js";
import { scheduleAllWebhooks } from "./lib/webhook-scheduler.js";
import {
  getOrCreateUser,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getUserFromContext,
} from "./lib/auth.js";
import type { Context } from "./routes/trpc.js";
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

// Dev login endpoint (only in non-production)
if (process.env.NODE_ENV !== "production") {
  app.post("/auth/dev-login", async (c) => {
    try {
      const body = await c.req.json();
      const googleId = body.googleId;

      if (!googleId || typeof googleId !== "string") {
        return c.text("googleId is required", 400);
      }

      // Prefix dev accounts to distinguish them
      const devGoogleId = googleId.startsWith("dev_") ? googleId : `dev_${googleId}`;

      // Get or create user
      const { user, isNewUser } = await getOrCreateUser(devGoogleId);

      // Create session
      const sessionToken = await createSessionToken(user);
      setSessionCookie(c, sessionToken);

      console.log(`[Dev Login] User logged in: ${user.id} (${devGoogleId}), isNewUser: ${isNewUser}`);

      return c.json({
        success: true,
        isNewUser,
        user: { id: user.id, googleId: user.googleId },
      });
    } catch (error) {
      console.error("[Dev Login] Failed:", error);
      return c.text("Dev login failed", 500);
    }
  });
}

// Set session endpoint (used by OAuth callback to set cookie)
app.post("/auth/set-session", async (c) => {
  try {
    const body = await c.req.json();
    const token = body.token;

    if (!token || typeof token !== "string") {
      return c.text("Token is required", 400);
    }

    setSessionCookie(c, token);
    return c.json({ success: true });
  } catch (error) {
    console.error("[Auth] Set session failed:", error);
    return c.text("Set session failed", 500);
  }
});

// Logout endpoint
app.post("/auth/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ success: true });
});

// tRPC handler with context
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: async (_opts, c): Promise<Context> => {
      const user = await getUserFromContext(c);
      return { user };
    },
  })
);

const port = parseInt(process.env.PORT || "3081", 10);

console.log(`API server running on http://localhost:${port}`);
console.log(`CORS origin: ${corsOrigin}`);

serve({
  fetch: app.fetch,
  port,
});

export type { AppRouter } from "./routes/index.js";
