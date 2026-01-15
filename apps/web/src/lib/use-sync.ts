// Hook for background sync between local and server
import { useEffect, useRef, useCallback, useState } from "react";
import { fullSync, type SyncEntry } from "./sync";
import { trpc } from "./trpc";

const LAST_SYNCED_KEY = "til-last-synced";

interface UseSyncOptions {
  enabled: boolean;
  onSyncComplete?: (result: { pushed: number; pulled: number }) => void;
  onSyncError?: (error: Error) => void;
}

function getLastSyncedAt(): Date | null {
  const stored = localStorage.getItem(LAST_SYNCED_KEY);
  return stored ? new Date(stored) : null;
}

function setLastSyncedAt(date: Date): void {
  localStorage.setItem(LAST_SYNCED_KEY, date.toISOString());
}

export function useSync({ enabled, onSyncComplete, onSyncError }: UseSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAtState] = useState<Date | null>(getLastSyncedAt);
  const syncInProgressRef = useRef(false);
  const utils = trpc.useUtils();

  // Upsert entry to server
  const upsertToServer = useCallback(
    async (entry: { date: string; content: string }): Promise<SyncEntry> => {
      const result = await utils.client.entries.upsert.mutate(entry);
      return {
        id: result.id,
        date: result.date,
        content: result.content,
        userId: result.userId ?? null,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
    },
    [utils]
  );

  // Get all server entries for pull
  const getServerEntries = useCallback(async (): Promise<SyncEntry[]> => {
    // Get recent entries (last 60 days should be enough for sync)
    const result = await utils.client.entries.list.query({ limit: 100 });
    return result.items.map((item) => ({
      id: item.id,
      date: item.date,
      content: item.content,
      userId: item.userId ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }, [utils]);

  // Perform bidirectional sync (push + pull)
  const performSync = useCallback(async () => {
    if (syncInProgressRef.current || !enabled) return;

    syncInProgressRef.current = true;
    setIsSyncing(true);
    console.log("[useSync] Starting bidirectional sync...");

    try {
      const result = await fullSync(getServerEntries, upsertToServer);

      console.log(`[useSync] Sync complete: pushed=${result.pushedToServer}, pulled=${result.pulledFromServer}`);

      // Update last synced timestamp
      const now = new Date();
      setLastSyncedAt(now);
      setLastSyncedAtState(now);

      onSyncComplete?.({
        pushed: result.pushedToServer,
        pulled: result.pulledFromServer,
      });
    } catch (error) {
      console.error("[useSync] Sync failed:", error);
      onSyncError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      syncInProgressRef.current = false;
      setIsSyncing(false);
    }
  }, [enabled, getServerEntries, upsertToServer, onSyncComplete, onSyncError]);

  // Sync on mount when enabled
  useEffect(() => {
    if (enabled) {
      // Small delay to let service worker initialize
      const timer = setTimeout(performSync, 1000);
      return () => clearTimeout(timer);
    }
  }, [enabled, performSync]);

  // Debounced sync for use after mutations (waits 2 seconds of inactivity)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncAfterMutation = useCallback(() => {
    if (!enabled) return;

    // Clear existing timeout
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    // Set new timeout - sync after 2 seconds of inactivity
    syncTimeoutRef.current = setTimeout(() => {
      performSync();
    }, 2000);
  }, [enabled, performSync]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  return { sync: performSync, syncAfterMutation, isSyncing, lastSyncedAt };
}
