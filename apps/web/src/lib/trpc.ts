import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import type { AppRouter } from "@til-stack/api/routes";

export const trpc = createTRPCReact<AppRouter>();

// Use API_URL from environment, fallback to /trpc for dev proxy
const getBaseUrl = () => {
  const apiUrl = process.env.API_URL;
  if (apiUrl) {
    return `${apiUrl}/trpc`;
  }
  // In development, use the proxy
  return "/trpc";
};

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      // Split auth/webhooks requests from other requests
      // Auth and webhooks must go to server without batching with local-first queries
      splitLink({
        condition(op) {
          // Auth and webhooks should never be batched with other queries
          // They need to go directly to the server
          return op.path.startsWith("auth.") || op.path.startsWith("webhooks.");
        },
        // Auth/webhooks use non-batched link (separate requests)
        true: httpLink({
          url: getBaseUrl(),
        }),
        // All other queries can be batched together (handled by service worker)
        false: httpBatchLink({
          url: getBaseUrl(),
        }),
      }),
    ],
  });
}
