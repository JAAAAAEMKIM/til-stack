import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleIcon } from "@/components/icons/google";
import { useAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { sharedWorkerClient } from "@/lib/shared-worker-client";
import { Loader2, AlertTriangle, Code } from "lucide-react";
import { rootRoute } from "./__root";

// Helper to send message to shared worker and wait for response
async function sendToSharedWorker<T>(message: Record<string, unknown>): Promise<T> {
  await sharedWorkerClient.ready();
  return sharedWorkerClient.send<T>(message);
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

function LoginPage() {
  const { isLoggedIn, isLoading, refreshUser } = useAuth();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [devGoogleId, setDevGoogleId] = useState("");
  const [devError, setDevError] = useState("");
  const [isDevLoggingIn, setIsDevLoggingIn] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      navigate({ to: "/" });
    }
  }, [isLoading, isLoggedIn, navigate]);

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      const apiUrl = process.env.API_URL || "";
      const res = await fetch(`${apiUrl}/trpc/auth.getGoogleAuthUrl`, {
        credentials: "include",
      });
      const data = await res.json();
      const url = data?.result?.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        console.error("Failed to get OAuth URL:", data);
        setIsSigningIn(false);
      }
    } catch (err) {
      console.error("Failed to get OAuth URL:", err);
      setIsSigningIn(false);
    }
  };

  const handleDevLogin = async () => {
    if (!devGoogleId.trim()) {
      setDevError("Please enter a Google ID");
      return;
    }

    setIsDevLoggingIn(true);
    setDevError("");

    try {
      const apiUrl = process.env.API_URL || "";
      const res = await fetch(`${apiUrl}/auth/dev-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ googleId: devGoogleId.trim() }),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || "Dev login failed");
      }

      const data = await res.json();
      const userId = data?.user?.id;
      const isNewUser = data?.isNewUser ?? false;

      console.log(`[DevLogin] userId=${userId}, isNewUser=${isNewUser}`);

      // Tell service worker to handle login with appropriate sync strategy
      // Only migrate anonymous data for NEW users
      // Existing users should NOT merge anonymous data - it stays separate
      if (userId) {
        try {
          await sendToSharedWorker<{
            success: boolean;
            migrated: boolean;
            merged: boolean;
            pulled: number;
            mergedEntries: number;
          }>({
            type: "USER_LOGIN",
            userId: userId,
            isNewUser: isNewUser,
            mergeAnonymous: isNewUser, // Only merge for new users, not returning users
          });
        } catch (syncError) {
          console.warn("[DevLogin] Sync failed, continuing:", syncError);
        }
      }

      // Reset all cached queries to clear stale data and force fresh fetch from new database
      // Using reset() instead of invalidate() to ensure no stale data is shown
      await utils.entries.list.reset();
      await utils.entries.getByDate.reset();
      await utils.config.getSkipDays.reset();
      await utils.config.getTemplates.reset();

      // Refresh user state
      await refreshUser();
      navigate({ to: "/" });
    } catch (err) {
      console.error("Dev login failed:", err);
      setDevError(err instanceof Error ? err.message : "Dev login failed");
      setIsDevLoggingIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      {/* Google OAuth Login */}
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign in to TIL Stack</CardTitle>
          <CardDescription>
            Sync your entries across devices and enable webhooks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full"
            size="lg"
            onClick={handleGoogleLogin}
            disabled={isSigningIn}
          >
            {isSigningIn ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <GoogleIcon className="mr-2 h-5 w-5" />
            )}
            {isSigningIn ? "Signing in..." : "Continue with Google"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Without signing in, your data is stored locally in your browser.
          </p>
        </CardContent>
      </Card>

      {/* Dev Login Section - only in development */}
      {process.env.NODE_ENV !== "production" && (
        <Card className="w-full max-w-sm border-dashed border-amber-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-600">
              <Code className="h-5 w-5" />
              Development Login
            </CardTitle>
            <CardDescription className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span>For testing only. Enter any Google ID to create/login as a test user.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dev-google-id">Test Google ID</Label>
              <Input
                id="dev-google-id"
                placeholder="e.g., test-user-123"
                value={devGoogleId}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDevGoogleId(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleDevLogin()}
              />
              {devError && (
                <p className="text-sm text-destructive">{devError}</p>
              )}
            </div>
            <Button
              variant="outline"
              className="w-full border-amber-500/50 hover:bg-amber-500/10"
              onClick={handleDevLogin}
              disabled={isDevLoggingIn}
            >
              {isDevLoggingIn ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Code className="mr-2 h-4 w-4" />
              )}
              {isDevLoggingIn ? "Logging in..." : "Dev Login"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
