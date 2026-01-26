// IndexedDB persistence for sql.js database
// Each user (including anonymous) has their own namespaced storage

const DB_NAME = "til-stack-local";
const STORE_NAME = "database";
const ANONYMOUS_USER_ID = "anonymous";

// Get the storage key for a user
function getStorageKey(userId: string | null): string {
  return `sqlite-data-${userId || ANONYMOUS_USER_ID}`;
}

// Current user ID (set by service worker on login/logout)
let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
  console.log(`[Persistence] Current user set to: ${userId || ANONYMOUS_USER_ID}`);
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

// Store the last key used for debugging
export let lastLoadKey: string | null = null;

// Track clear operation results
export let lastClearResult: { key: string; sizeBeforeDelete: number | null; timestamp: string } | null = null;

// Track cleared keys to detect saves after clear
export let clearedKeys: Set<string> = new Set();

// Track the last load diagnostic
export let lastLoadDiagnostic: { key: string; allKeysAtLoad: string[]; keyExists: boolean; dataSize: number | null } | null = null;

// Track ALL load diagnostics (history) - for debugging race conditions
export let loadDiagnosticHistory: Array<{ key: string; allKeysAtLoad: string[]; keyExists: boolean; dataSize: number | null; timestamp: string }> = [];

// Track ALL save operations (history) - for debugging writes
export let saveDiagnosticHistory: Array<{ key: string; dataSize: number; timestamp: string; stack?: string }> = [];

export async function loadFromIndexedDB(userId?: string | null): Promise<Uint8Array | null> {
  const key = getStorageKey(userId !== undefined ? userId : currentUserId);
  lastLoadKey = key;
  console.log(`[Persistence] Loading database for key: ${key}, param userId: ${userId}, currentUserId: ${currentUserId}`);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);

      // First get all keys to diagnose the state
      const getAllKeysRequest = store.getAllKeys();
      getAllKeysRequest.onsuccess = () => {
        const allKeys = getAllKeysRequest.result as string[];
        const keyExists = allKeys.includes(key);
        console.log(`[Persistence] getAllKeys at load: ${JSON.stringify(allKeys)}, target key ${key} exists: ${keyExists}`);

        const getRequest = store.get(key);
        getRequest.onsuccess = () => {
          const result = getRequest.result || null;
          const dataSize = result ? result.length : null;
          console.log(`[Persistence] loadFromIndexedDB result for key=${key}: ${result ? `${result.length} bytes` : 'null'}`);

          // Store diagnostic info
          lastLoadDiagnostic = {
            key,
            allKeysAtLoad: allKeys,
            keyExists,
            dataSize,
          };

          // Also add to history (keep last 10)
          loadDiagnosticHistory.push({
            key,
            allKeysAtLoad: allKeys,
            keyExists,
            dataSize,
            timestamp: new Date().toISOString(),
          });
          if (loadDiagnosticHistory.length > 10) {
            loadDiagnosticHistory.shift();
          }

          resolve(result);
        };

        getRequest.onerror = () => {
          reject(getRequest.error);
        };
      };

      getAllKeysRequest.onerror = () => {
        // Fallback: still try to get the data
        const getRequest = store.get(key);
        getRequest.onsuccess = () => {
          const result = getRequest.result || null;
          console.log(`[Persistence] loadFromIndexedDB result for key=${key}: ${result ? `${result.length} bytes` : 'null'}`);
          resolve(result);
        };
        getRequest.onerror = () => {
          reject(getRequest.error);
        };
      };
    };
  });
}

export async function saveToIndexedDB(data: Uint8Array, userId?: string | null): Promise<void> {
  const effectiveUserId = userId !== undefined ? userId : currentUserId;
  const key = getStorageKey(effectiveUserId);
  const timestamp = new Date().toISOString();

  // Capture stack trace for debugging
  const stack = new Error().stack?.split('\n').slice(2, 5).join('\n');

  console.log(`[Persistence] Saving database for key: ${key}, size: ${data.length} bytes, userId param: ${userId}, currentUserId: ${currentUserId}`);

  // Track all save operations
  saveDiagnosticHistory.push({
    key,
    dataSize: data.length,
    timestamp,
    stack,
  });
  if (saveDiagnosticHistory.length > 20) {
    saveDiagnosticHistory.shift();
  }

  // CRITICAL DEBUG: Detect when we're saving to a key that was previously cleared
  if (clearedKeys.has(key)) {
    console.error(`[Persistence] ⚠️ SAVE TO CLEARED KEY: Saving ${data.length} bytes to previously cleared key ${key}!`);
    console.error(`[Persistence] userId param: ${userId}, currentUserId module: ${currentUserId}`);
    console.error(`[Persistence] Stack trace:\n${stack}`);
    // Don't actually remove from clearedKeys - keep tracking
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const putRequest = store.put(data, key);

      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
  });
}

export async function clearUserDatabase(userId?: string | null): Promise<void> {
  const effectiveUserId = userId !== undefined ? userId : currentUserId;
  const key = getStorageKey(effectiveUserId);
  console.log(`[Persistence] Clearing database for key: ${key}, userId param: ${userId}, currentUserId: ${currentUserId}`);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      // DEBUG: Check what exists before delete
      const checkBeforeDelete = store.get(key);
      checkBeforeDelete.onsuccess = () => {
        const sizeBeforeDelete = checkBeforeDelete.result ? (checkBeforeDelete.result as Uint8Array).length : null;
        console.log(`[Persistence] BEFORE delete - key ${key}: ${sizeBeforeDelete ? `${sizeBeforeDelete} bytes` : 'null'}`);
        lastClearResult = { key, sizeBeforeDelete, timestamp: new Date().toISOString() };
      };

      const deleteRequest = store.delete(key);

      deleteRequest.onsuccess = () => {
        console.log(`[Persistence] DELETE SUCCESS - key ${key}`);
        clearedKeys.add(key);
        resolve();
      };
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
  });
}

// Check if a user has existing data in IndexedDB
export async function hasUserData(userId: string | null): Promise<boolean> {
  const data = await loadFromIndexedDB(userId);
  return data !== null && data.length > 0;
}

// Migrate anonymous data to a user's namespace (for first-time login)
export async function migrateAnonymousToUser(userId: string): Promise<boolean> {
  console.log(`[Persistence] Migrating anonymous data to user: ${userId}`);

  const anonymousData = await loadFromIndexedDB(null);
  if (!anonymousData || anonymousData.length === 0) {
    console.log("[Persistence] No anonymous data to migrate");
    return false;
  }

  // Check if user already has data
  const existingUserData = await loadFromIndexedDB(userId);
  if (existingUserData && existingUserData.length > 0) {
    console.log("[Persistence] User already has data, skipping migration");
    return false;
  }

  // Copy anonymous data to user namespace
  await saveToIndexedDB(anonymousData, userId);
  await clearUserDatabase(null);  // Clear anonymous data after migration
  console.log("[Persistence] Anonymous data migrated to user namespace");
  return true;
}

// Merge anonymous data into user's database (for returning users with new anonymous data)
// This is called when a user logs out, creates data anonymously, then logs back in
export async function mergeAnonymousToUser(userId: string): Promise<{
  merged: boolean;
  entriesMerged: number;
  skipDaysMerged: number;
  templatesMerged: number;
}> {
  console.log(`[Persistence] Merging anonymous data to user: ${userId}`);

  const result = {
    merged: false,
    entriesMerged: 0,
    skipDaysMerged: 0,
    templatesMerged: 0,
  };

  const anonymousData = await loadFromIndexedDB(null);
  if (!anonymousData || anonymousData.length === 0) {
    console.log("[Persistence] No anonymous data to merge");
    return result;
  }

  // Return the raw anonymous database bytes so the service worker can handle merging
  // The actual merge logic is in the service worker which has access to sql.js
  console.log(`[Persistence] Anonymous data found: ${anonymousData.length} bytes`);
  result.merged = true;
  return result;
}

// Get raw anonymous database bytes for merging
export async function getAnonymousData(): Promise<Uint8Array | null> {
  return loadFromIndexedDB(null);
}

// Legacy function for backwards compatibility
export async function clearLocalDatabase(): Promise<void> {
  return clearUserDatabase(currentUserId);
}
