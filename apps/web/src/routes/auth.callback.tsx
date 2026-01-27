import { createRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/lib/auth-context";
import { rootRoute } from "./__root";

const searchSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
});

export const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/callback",
  validateSearch: searchSchema,
  component: AuthCallbackPage,
});

// Helper to send message to service worker and wait for response
async function sendToServiceWorker<T>(message: Record<string, unknown>): Promise<T> {
  const registration = await navigator.serviceWorker?.ready;
  if (!registration?.active) {
    throw new Error("Service worker not ready");
  }

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      if (event.data?.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data);
      }
    };
    registration.active?.postMessage(message, [messageChannel.port2]);
    setTimeout(() => reject(new Error("Service worker timeout")), 30000);
  });
}

// Check if user has existing data in IndexedDB
async function checkUserHasData(userId: string): Promise<boolean> {
  try {
    const result = await sendToServiceWorker<{ hasData: boolean }>({
      type: "CHECK_USER_DATA",
      userId,
    });
    return result.hasData;
  } catch {
    return false;
  }
}

function AuthCallbackPage() {
  const { code, error } = useSearch({ from: "/auth/callback" });
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState<"loading" | "syncing" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const handleCallbackMutation = trpc.auth.handleCallback.useMutation();

  useEffect(() => {
    async function handleCallback() {
      if (error) {
        setStatus("error");
        setErrorMessage(`OAuth error: ${error}`);
        return;
      }

      if (!code) {
        setStatus("error");
        setErrorMessage("No authorization code received");
        return;
      }

      try {
        // Exchange code for session
        const result = await handleCallbackMutation.mutateAsync({ code });

        if (result.success && result.sessionToken && result.user) {
          // Set the session cookie via API
          const apiUrl = process.env.API_URL || "";
          await fetch(`${apiUrl}/auth/set-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ token: result.sessionToken }),
          });

          setStatus("syncing");

          // Determine if this is a new user or existing user
          // New user = first time logging in (no server-side entries yet)
          // Existing user = has logged in before (possibly on another device)
          const isNewUser = result.isNewUser ?? false;

          // Check if user has local data (from previous session)
          const hasLocalData = await checkUserHasData(result.user.id);

          console.log(`[Auth] Login: isNewUser=${isNewUser}, hasLocalData=${hasLocalData}`);

          // Tell service worker to handle login with appropriate sync strategy
          // Only migrate anonymous data for NEW users
          // Existing users should NOT merge anonymous data - it stays separate
          try {
            const syncResult = await sendToServiceWorker<{
              success: boolean;
              migrated: boolean;
              merged: boolean;
              pulled: number;
              mergedEntries: number;
            }>({
              type: "USER_LOGIN",
              userId: result.user.id,
              isNewUser: isNewUser,
              mergeAnonymous: isNewUser, // Only merge for new users, not returning users
            });

            if (syncResult.migrated) {
              setSyncInfo("Migrated local data to your account");
            } else if (syncResult.merged && syncResult.mergedEntries > 0) {
              setSyncInfo(`Merged ${syncResult.mergedEntries} local entries to your account`);
            } else if (syncResult.pulled > 0) {
              setSyncInfo(`Synced ${syncResult.pulled} entries from server`);
            }
          } catch (syncError) {
            console.warn("[Auth] Sync failed, continuing:", syncError);
            // Fallback: just notify SW of login state
            navigator.serviceWorker?.controller?.postMessage({
              type: "USER_LOGGED_IN",
              userId: result.user.id,
            });
          }

          // Refresh user state
          await refreshUser();

          setStatus("success");

          // Redirect to home after brief success message
          setTimeout(() => {
            navigate({ to: "/" });
          }, 1500);
        } else {
          throw new Error("Failed to create session");
        }
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Authentication failed");
      }
    }

    handleCallback();
  }, [code, error, handleCallbackMutation, navigate, refreshUser]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>
            {status === "loading" && "Signing in..."}
            {status === "syncing" && "Syncing..."}
            {status === "success" && "Welcome!"}
            {status === "error" && "Sign in failed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {(status === "loading" || status === "syncing") && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              {status === "syncing" && (
                <p className="text-sm text-muted-foreground">
                  Setting up your data...
                </p>
              )}
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-sm text-muted-foreground">
                {syncInfo || "Redirecting..."}
              </p>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-destructive">{errorMessage}</p>
              <button
                onClick={() => navigate({ to: "/login" })}
                className="text-sm text-primary underline"
              >
                Try again
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
