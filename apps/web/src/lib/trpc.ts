import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
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
      httpBatchLink({
        url: getBaseUrl(),
      }),
    ],
  });
}
