// Data migration from local IndexedDB to server

interface LocalEntry {
  id: string;
  date: string;
  content: string;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LocalSkipDay {
  id: string;
  type: string;
  value: string;
  userId: string | null;
  createdAt: string;
}

interface LocalTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MigrationData {
  entries: LocalEntry[];
  skipDays: LocalSkipDay[];
  templates: LocalTemplate[];
}

// Query local database from service worker
async function queryLocalData(): Promise<MigrationData | null> {
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

export async function migrateLocalDataToServer(
  migrateDataFn: (data: MigrationData) => Promise<void>
): Promise<{ migrated: boolean; entriesCount: number }> {
  try {
    const localData = await queryLocalData();

    if (!localData) {
      console.log("[Migration] No local data to migrate");
      return { migrated: false, entriesCount: 0 };
    }

    const { entries, skipDays, templates } = localData;
    const totalItems = entries.length + skipDays.length + templates.length;

    if (totalItems === 0) {
      console.log("[Migration] No items to migrate");
      return { migrated: false, entriesCount: 0 };
    }

    console.log(`[Migration] Migrating ${entries.length} entries, ${skipDays.length} skip days, ${templates.length} templates`);

    // Send to server
    await migrateDataFn({ entries, skipDays, templates });

    // DO NOT clear local database - local-first architecture keeps local as source of truth

    // Notify service worker
    navigator.serviceWorker.controller?.postMessage({ type: "USER_LOGGED_IN" });

    console.log("[Migration] Complete");
    return { migrated: true, entriesCount: entries.length };
  } catch (error) {
    console.error("[Migration] Failed:", error);
    throw error;
  }
}
