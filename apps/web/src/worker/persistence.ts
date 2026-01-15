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

export async function loadFromIndexedDB(userId?: string | null): Promise<Uint8Array | null> {
  const key = getStorageKey(userId !== undefined ? userId : currentUserId);
  console.log(`[Persistence] Loading database for key: ${key}`);

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
      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        resolve(getRequest.result || null);
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    };
  });
}

export async function saveToIndexedDB(data: Uint8Array, userId?: string | null): Promise<void> {
  const key = getStorageKey(userId !== undefined ? userId : currentUserId);
  console.log(`[Persistence] Saving database for key: ${key}`);

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
  const key = getStorageKey(userId !== undefined ? userId : currentUserId);
  console.log(`[Persistence] Clearing database for key: ${key}`);

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
      const deleteRequest = store.delete(key);

      deleteRequest.onsuccess = () => resolve();
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
  console.log("[Persistence] Anonymous data migrated to user namespace");
  return true;
}

// Legacy function for backwards compatibility
export async function clearLocalDatabase(): Promise<void> {
  return clearUserDatabase(currentUserId);
}
