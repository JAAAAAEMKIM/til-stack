import { router } from "./trpc.js";
import { entriesRouter } from "./entries.js";
import { configRouter } from "./config.js";
import { webhooksRouter } from "./webhooks.js";

export const appRouter = router({
  entries: entriesRouter,
  config: configRouter,
  webhooks: webhooksRouter,
});

export type AppRouter = typeof appRouter;
