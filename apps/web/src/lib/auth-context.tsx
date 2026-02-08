import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trpc } from "./trpc";
import { sharedWorkerClient } from "./shared-worker-client";

export interface User {
  id: string;
  googleId: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  isSyncing: boolean;
  login: () => void;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshUser: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: ReactNode;
}

// Helper to send message to shared worker and wait for response
async function sendToSharedWorker<T>(message: Record<string, unknown>): Promise<T> {
  await sharedWorkerClient.ready();
  return sharedWorkerClient.send<T>(message);
}

/**
 * Wait for shared worker to be ready.
 * SharedWorker is always available immediately after instantiation.
 */
async function waitForSharedWorker(): Promise<boolean> {
  try {
    await sharedWorkerClient.ready();
    return true;
  } catch (err) {
    console.warn("[Auth] SharedWorker ready check failed:", err);
    return false;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isWorkerReady, setIsWorkerReady] = useState(false);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const queryClient = useQueryClient();

  // Query current user
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Mutations
  const logoutMutation = trpc.auth.logout.useMutation();
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation();

  // Sync user state with query and notify shared worker
  // CRITICAL: We must AWAIT the shared worker switch before setting isLoading=false
  // Otherwise, queries will fire before the worker has switched to the correct user database
  useEffect(() => {
    if (meQuery.isLoading) {
      return; // Don't set isLoading=true here, it starts true
    }

    const newUser = meQuery.data ?? null;
    const newUserId = newUser?.id ?? null;
    const prevUserId = prevUserIdRef.current;

    // Detect actual user change (not just initial load)
    const userChanged = prevUserId !== undefined && prevUserId !== newUserId;
    if (userChanged) {
      console.log(`[Auth] User changed from ${prevUserId} to ${newUserId}, clearing query cache`);
      queryClient.clear();
    }

    // Skip if same user and already ready (prevents unnecessary re-runs)
    if (!userChanged && isWorkerReady && prevUserId === newUserId) {
      return;
    }

    // Update refs before async operation
    prevUserIdRef.current = newUserId;

    // Notify shared worker and WAIT for acknowledgment before proceeding
    // This prevents race conditions where queries fire before worker switches databases
    const notifyAndFinish = async () => {
      // Wait for SharedWorker to be ready
      console.log(`[Auth] Waiting for SharedWorker...`);
      const hasWorker = await waitForSharedWorker();
      if (!hasWorker) {
        console.warn(`[Auth] Proceeding without SharedWorker - this may cause data isolation issues`);
      }

      // Only notify worker if user is logged in
      if (newUser) {
        console.log(`[Auth] Notifying SharedWorker of user ${newUserId} and waiting for response...`);

        try {
          // Use sendToSharedWorker which awaits the response
          // This is idempotent - multiple calls with same userId are safe
          await sendToSharedWorker({
            type: "USER_LOGGED_IN",
            userId: newUser.id,
          });
          console.log(`[Auth] SharedWorker acknowledged user switch to ${newUserId}`);
        } catch (error) {
          console.warn(`[Auth] SharedWorker notification failed:`, error);
          // Continue anyway - worker might not be ready yet
        }
      } else {
        // CRITICAL: Also notify worker for anonymous users
        // This ensures the database is initialized for anonymous usage,
        // regardless of navigation path (direct visit vs. login page -> home)
        console.log(`[Auth] Notifying SharedWorker of anonymous user...`);
        try {
          await sendToSharedWorker({ type: "USER_ANONYMOUS" });
          console.log(`[Auth] SharedWorker acknowledged anonymous user`);
        } catch (error) {
          console.warn(`[Auth] SharedWorker anonymous notification failed:`, error);
        }
      }

      // Always set these at the end
      setIsWorkerReady(true);
      setUser(newUser);
      setIsLoading(false);
    };

    notifyAndFinish();
  }, [meQuery.isLoading, meQuery.data, queryClient, isWorkerReady]);

  // SharedWorker doesn't need restart detection like ServiceWorker
  // The SharedWorker persists across page reloads and is always available
  // If the worker crashes, the client will automatically attempt to reconnect

  // Online/offline event handlers - notify shared worker for sync
  useEffect(() => {
    const handleOnline = async () => {
      console.log("[Auth] Browser went online");
      try {
        await sendToSharedWorker({
          type: "SET_ONLINE_STATUS",
          online: true,
        });
        // Also trigger a retry for pending operations
        if (user) {
          await sendToSharedWorker({ type: "RETRY_SYNC" });
        }
      } catch (err) {
        console.warn("[Auth] Online notification or retry sync failed:", err);
      }
    };

    const handleOffline = async () => {
      console.log("[Auth] Browser went offline");
      try {
        await sendToSharedWorker({
          type: "SET_ONLINE_STATUS",
          online: false,
        });
      } catch (err) {
        console.warn("[Auth] Offline notification failed:", err);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Set initial status
    (async () => {
      try {
        await sharedWorkerClient.ready();
        await sendToSharedWorker({
          type: "SET_ONLINE_STATUS",
          online: navigator.onLine,
        });
      } catch (err) {
        console.warn("[Auth] Initial online status notification failed:", err);
      }
    })();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [user]);

  // Redirect to Google OAuth
  const login = useCallback(() => {
    const apiUrl = process.env.API_URL || "";
    window.location.href = `${apiUrl}/trpc/auth.getGoogleAuthUrl`;
  }, []);

  // Manual sync trigger - delegates to shared worker
  const triggerSync = useCallback(async () => {
    if (!user) return;

    setIsSyncing(true);
    try {
      await sendToSharedWorker({ type: "SYNC_NOW" });
      console.log("[Auth] Manual sync complete");
    } catch (error) {
      console.error("[Auth] Manual sync failed:", error);
    } finally {
      setIsSyncing(false);
    }
  }, [user]);

  // Helper to clear local data via shared worker
  const clearLocalData = useCallback(async (): Promise<boolean> => {
    try {
      const result = await sendToSharedWorker<{ success: boolean }>({
        type: "CLEAR_LOCAL_DATA",
      });
      return result.success;
    } catch {
      return false;
    }
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      // Ask if user wants to clear local data (for shared devices)
      const shouldClearData = confirm(
        "Do you want to clear local data? Select OK to clear data (recommended for shared devices), or Cancel to keep data for offline access."
      );

      await logoutMutation.mutateAsync();
      // Clear session cookie via API
      const apiUrl = process.env.API_URL || "";
      await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUser(null);

      // Clear local data if requested
      if (shouldClearData) {
        await clearLocalData();
      }

      // Notify shared worker of logout and WAIT for it to switch namespaces
      await sendToSharedWorker({ type: "USER_LOGGED_OUT" });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }, [logoutMutation, clearLocalData]);

  // Delete account
  const deleteAccount = useCallback(async () => {
    if (!confirm("Are you sure you want to delete your account? This cannot be undone.")) {
      return;
    }
    try {
      await deleteAccountMutation.mutateAsync();
      // Clear session cookie via API
      const apiUrl = process.env.API_URL || "";
      await fetch(`${apiUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      setUser(null);

      // Clear local data
      await clearLocalData();

      // Notify shared worker and WAIT for it to switch namespaces
      await sendToSharedWorker({ type: "USER_LOGGED_OUT" });
    } catch (error) {
      console.error("Delete account failed:", error);
    }
  }, [deleteAccountMutation, clearLocalData]);

  // Refresh user data
  const refreshUser = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isLoggedIn: !!user,
    isSyncing,
    login,
    logout,
    deleteAccount,
    refreshUser,
    triggerSync,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
