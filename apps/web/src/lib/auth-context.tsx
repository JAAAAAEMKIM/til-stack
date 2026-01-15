import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { trpc } from "./trpc";

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

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Query current user
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Mutations
  const logoutMutation = trpc.auth.logout.useMutation();
  const deleteAccountMutation = trpc.auth.deleteAccount.useMutation();

  // Sync user state with query
  useEffect(() => {
    if (meQuery.isLoading) {
      setIsLoading(true);
    } else {
      const newUser = meQuery.data ?? null;
      setUser(newUser);
      setIsLoading(false);

      // Notify service worker of auth state (userId for namespaced storage)
      if (newUser) {
        navigator.serviceWorker?.controller?.postMessage({
          type: "USER_LOGGED_IN",
          userId: newUser.id,
        });
      }
    }
  }, [meQuery.isLoading, meQuery.data]);

  // Online/offline event handlers - notify service worker for sync
  useEffect(() => {
    const handleOnline = () => {
      console.log("[Auth] Browser went online");
      navigator.serviceWorker?.controller?.postMessage({
        type: "SET_ONLINE_STATUS",
        online: true,
      });
      // Also trigger a retry for pending operations
      if (user) {
        sendToServiceWorker({ type: "RETRY_SYNC" }).catch((err) => {
          console.warn("[Auth] Retry sync on reconnect failed:", err);
        });
      }
    };

    const handleOffline = () => {
      console.log("[Auth] Browser went offline");
      navigator.serviceWorker?.controller?.postMessage({
        type: "SET_ONLINE_STATUS",
        online: false,
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Set initial status
    navigator.serviceWorker?.controller?.postMessage({
      type: "SET_ONLINE_STATUS",
      online: navigator.onLine,
    });

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

  // Manual sync trigger - delegates to service worker
  const triggerSync = useCallback(async () => {
    if (!user) return;

    setIsSyncing(true);
    try {
      await sendToServiceWorker({ type: "SYNC_NOW" });
      console.log("[Auth] Manual sync complete");
    } catch (error) {
      console.error("[Auth] Manual sync failed:", error);
    } finally {
      setIsSyncing(false);
    }
  }, [user]);

  // Helper to clear local data via service worker
  const clearLocalData = useCallback(async (): Promise<boolean> => {
    try {
      const result = await sendToServiceWorker<{ success: boolean }>({
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

      // Notify service worker of logout
      navigator.serviceWorker?.controller?.postMessage({ type: "USER_LOGGED_OUT" });
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

      // Notify service worker
      navigator.serviceWorker?.controller?.postMessage({ type: "USER_LOGGED_OUT" });
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
