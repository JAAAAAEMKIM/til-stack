import { useEffect, useMemo, useCallback } from "react";
import { trpc } from "./trpc";
import { useAuth } from "./auth-context";

export type Theme = "system" | "light" | "dark";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const resolved = theme === "system" ? getSystemTheme() : theme;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

export function useTheme() {
  const { isLoading: isAuthLoading } = useAuth();

  // Query preferences from DB (works for both anonymous and logged-in)
  const prefsQuery = trpc.config.getPreferences.useQuery(undefined, {
    enabled: !isAuthLoading,
    staleTime: Infinity,
  });

  // Mutation to save preferences
  const setPreferencesMutation = trpc.config.setPreferences.useMutation({
    onSuccess: () => {
      prefsQuery.refetch();
    },
  });

  // Parse theme from DB response or default to "system"
  const theme = useMemo<Theme>(() => {
    if (!prefsQuery.data?.theme) return "system";
    return prefsQuery.data.theme as Theme;
  }, [prefsQuery.data?.theme]);

  // Apply theme when it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen to system theme changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setPreferencesMutation.mutate({ theme: newTheme });
    },
    [setPreferencesMutation]
  );

  return { theme, setTheme };
}

// initTheme now does nothing - CSS handles initial theme
export function initTheme() {
  // No-op: CSS prefers-color-scheme handles initial theme
}
