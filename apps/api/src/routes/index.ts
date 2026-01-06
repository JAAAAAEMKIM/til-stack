import { router } from "./trpc.js";
import { entriesRouter } from "./entries.js";
import { configRouter } from "./config.js";

export const appRouter = router({
  entries: entriesRouter,
  config: configRouter,
});

export type AppRouter = typeof appRouter;
