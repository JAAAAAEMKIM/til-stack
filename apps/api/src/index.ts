import "dotenv/config";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./routes/index.js";

const app = new Hono();

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
