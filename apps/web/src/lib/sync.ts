// Local-first sync between IndexedDB and server
// Strategy: Client pushes to server, server handles merge with last-write-wins

export interface SyncEntry {
  id: string;
  date: string;
  content: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncSkipDay {
  id: string;
  type: string;
  value: string;
  userId: string | null;
  createdAt: string;
}

export interface SyncTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalData {
  entries: SyncEntry[];
  skipDays: SyncSkipDay[];
  templates: SyncTemplate[];
}

export interface SyncResult {
  pushedToServer: number;
  pulledFromServer: number;
}

// Query local database from service worker
export async function getLocalData(): Promise<LocalData | null> {
  if (!navigator.serviceWorker?.controller) {
    console.log("[Sync] Service worker not ready");
    return null;
  }

  const registration = await navigator.serviceWorker.ready;

  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      resolve(event.data);
    };

    registration.active?.postMessage(
      { type: "EXPORT_DATA" },
      [messageChannel.port2]
    );

    // Timeout after 5 seconds
    setTimeout(() => resolve(null), 5000);
  });
}

// Update local database via service worker
async function updateLocalEntry(entry: SyncEntry): Promise<void> {
  const registration = await navigator.serviceWorker.ready;

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.success) {
        resolve();
      } else {
        reject(new Error(event.data.error || "Failed to update local entry"));
      }
    };

    registration.active?.postMessage(
      { type: "UPDATE_ENTRY", entry },
      [messageChannel.port2]
    );

    setTimeout(() => reject(new Error("Timeout")), 5000);
  });
}

// Push local entries to server (server handles merge)
async function pushEntries(
  localEntries: SyncEntry[],
  upsertToServer: (entry: { date: string; content: string }) => Promise<SyncEntry>
): Promise<number> {
  let pushed = 0;

  for (const entry of localEntries) {
    await upsertToServer({ date: entry.date, content: entry.content });
    pushed++;
  }

  return pushed;
}

// Pull server entries to local (only use on initial load or explicit sync)
async function pullEntries(
  serverEntries: SyncEntry[]
): Promise<number> {
  let pulled = 0;

  for (const entry of serverEntries) {
    await updateLocalEntry(entry);
    pulled++;
  }

  return pulled;
}

// Push-only sync (normal operation - server handles merge)
export async function syncWithServer(
  upsertToServer: (entry: { date: string; content: string }) => Promise<SyncEntry>,
  syncConfigToServer?: (data: { skipDays: SyncSkipDay[]; templates: SyncTemplate[] }) => Promise<void>
): Promise<SyncResult> {
  console.log("[Sync] Starting push to server...");

  const result: SyncResult = {
    pushedToServer: 0,
    pulledFromServer: 0,
  };

  try {
    // Get local data
    const localData = await getLocalData();
    if (!localData) {
      console.log("[Sync] No local data available");
      return result;
    }

    // Push entries to server
    result.pushedToServer = await pushEntries(localData.entries, upsertToServer);

    // Push config (skip days, templates) to server
    if (syncConfigToServer && (localData.skipDays.length > 0 || localData.templates.length > 0)) {
      await syncConfigToServer({
        skipDays: localData.skipDays,
        templates: localData.templates,
      });
    }

    console.log(`[Sync] Push complete: pushed=${result.pushedToServer}`);
    return result;
  } catch (error) {
    console.error("[Sync] Push failed:", error);
    throw error;
  }
}

// Pull from server and update local (use on initial load or manual sync)
export async function pullFromServer(
  getServerEntries: () => Promise<SyncEntry[]>
): Promise<SyncResult> {
  console.log("[Sync] Starting pull from server...");

  const result: SyncResult = {
    pushedToServer: 0,
    pulledFromServer: 0,
  };

  try {
    // Get server entries
    const serverEntries = await getServerEntries();

    // Pull to local
    result.pulledFromServer = await pullEntries(serverEntries);

    console.log(`[Sync] Pull complete: pulled=${result.pulledFromServer}`);
    return result;
  } catch (error) {
    console.error("[Sync] Pull failed:", error);
    throw error;
  }
}

// Full sync: push then pull (use for manual sync or cross-device data merge)
export async function fullSync(
  getServerEntries: () => Promise<SyncEntry[]>,
  upsertToServer: (entry: { date: string; content: string }) => Promise<SyncEntry>,
  syncConfigToServer?: (data: { skipDays: SyncSkipDay[]; templates: SyncTemplate[] }) => Promise<void>
): Promise<SyncResult> {
  console.log("[Sync] Starting full sync (push + pull)...");

  // Push first
  const pushResult = await syncWithServer(upsertToServer, syncConfigToServer);

  // Then pull merged result
  const pullResult = await pullFromServer(getServerEntries);

  const result: SyncResult = {
    pushedToServer: pushResult.pushedToServer,
    pulledFromServer: pullResult.pulledFromServer,
  };

  console.log(`[Sync] Full sync complete: pushed=${result.pushedToServer}, pulled=${result.pulledFromServer}`);
  return result;
}

// Initial sync on login - just push local data to server without clearing
export async function initialSync(
  migrateDataFn: (data: LocalData) => Promise<void>
): Promise<{ synced: boolean; entriesCount: number }> {
  try {
    const localData = await getLocalData();

    if (!localData) {
      console.log("[Sync] No local data to sync");
      return { synced: false, entriesCount: 0 };
    }

    const { entries, skipDays, templates } = localData;
    const totalItems = entries.length + skipDays.length + templates.length;

    if (totalItems === 0) {
      console.log("[Sync] No items to sync");
      return { synced: false, entriesCount: 0 };
    }

    console.log(`[Sync] Initial sync: ${entries.length} entries, ${skipDays.length} skip days, ${templates.length} templates`);

    // Push to server (server handles merge with existing data)
    await migrateDataFn({ entries, skipDays, templates });

    // DO NOT clear local database - keep it for offline use

    console.log("[Sync] Initial sync complete");
    return { synced: true, entriesCount: entries.length };
  } catch (error) {
    console.error("[Sync] Initial sync failed:", error);
    throw error;
  }
}
