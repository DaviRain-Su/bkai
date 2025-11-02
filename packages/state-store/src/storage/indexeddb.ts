import { StateSnapshot, StateStoreBackend } from "../types";

const DEFAULT_DB_NAME = "bkai_reader_state";
const DEFAULT_STORE_NAME = "reading_state";
const DB_VERSION = 1;

export interface IndexedDbOptions {
  dbName?: string;
  storeName?: string;
}

export class IndexedDbBackend implements StateStoreBackend {
  private dbPromise: Promise<IDBDatabase>;
  private readonly storeName: string;

  constructor(options: IndexedDbOptions = {}) {
    const dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.storeName = options.storeName ?? DEFAULT_STORE_NAME;
    this.dbPromise = openDatabase(dbName, this.storeName);
  }

  async load(): Promise<StateSnapshot | undefined> {
    const db = await this.dbPromise;
    return new Promise<StateSnapshot | undefined>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get("snapshot");

      request.onsuccess = () => {
        resolve(request.result ?? undefined);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async save(snapshot: StateSnapshot): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(snapshot, "snapshot");

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export async function createIndexedDbBackend(options: IndexedDbOptions = {}) {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    throw new Error("IndexedDB not available in this environment");
  }
  return new IndexedDbBackend(options);
}

function openDatabase(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
