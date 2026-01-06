import { router } from "./trpc.js";
import { entriesRouter } from "./entries.js";

export const appRouter = router({
  entries: entriesRouter,
});

export type AppRouter = typeof appRouter;
