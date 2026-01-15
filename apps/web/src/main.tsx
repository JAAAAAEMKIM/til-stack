import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { trpc, createTRPCClient } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";
import { initTheme } from "./lib/theme";
import { AuthProvider } from "./lib/auth-context";
import "./styles/globals.css";

initTheme();

// Register Service Worker and wait for it to be ready before rendering
// This ensures the SW can intercept requests even when offline
async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    console.log("[App] Service Worker not supported");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/service-worker.js");
    console.log("[App] Service Worker registered:", registration.scope);

    // Wait for the SW to be ready and controlling this page
    await navigator.serviceWorker.ready;
    console.log("[App] Service Worker ready and controlling");
  } catch (error) {
    console.error("[App] Service Worker registration failed:", error);
  }
}

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Always execute queries regardless of network status
            // This allows the service worker to handle requests offline
            networkMode: "always",
          },
          mutations: {
            // Same for mutations - let service worker handle offline
            networkMode: "always",
          },
        },
      })
  );
  const [trpcClient] = useState(() => createTRPCClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

// Wait for SW before rendering to ensure offline requests are handled
registerServiceWorker().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
