import { createTRPCReact } from "@trpc/react-query";
import { httpLink, splitLink } from "@trpc/client";
import type { AppRouter } from "@til-stack/api/routes";
import { sharedWorkerLink } from "./shared-worker-link";
import { sharedWorkerClient } from "./shared-worker-client";

export const trpc = createTRPCReact<AppRouter>();

function getBaseUrl(): string {
  const apiUrl = process.env.API_URL;
  if (apiUrl) {
    return `${apiUrl}/trpc`;
  }
  return "/trpc";
}

export function createTRPCClient(): ReturnType<typeof trpc.createClient> {
  return trpc.createClient({
    links: [
      splitLink({
        condition(op) {
          // Auth and webhook test go to backend, rest through SharedWorker
          return op.path.startsWith("auth.") || op.path === "webhooks.test";
        },
        true: httpLink({ url: getBaseUrl() }),
        false: sharedWorkerLink(() => sharedWorkerClient.getPort()),
      }),
    ],
  });
}
