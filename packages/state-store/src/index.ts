import { EventBus } from "@core-platform";
import { createIndexedDbBackend, IndexedDbBackend } from "./storage/indexeddb";
import { createLocalStorageBackend, LocalStorageBackend } from "./storage/localStorage";
import {
  PageLocator,
  ReadingSessionState,
  StateSnapshot,
  StateStoreBackend,
} from "./types";

export type StateEvents = {
  "progress:updated": { bookId: string; location: PageLocator };
  "bookmark:added": { bookId: string; location: PageLocator };
};

export interface StateStoreOptions {
  backend?: StateStoreBackend;
}

export class InMemoryStateStore {
  private readonly sessions = new Map<string, ReadingSessionState>();
  private readonly events = new EventBus<StateEvents>();
  private readonly backend?: StateStoreBackend;
  private hydrated = false;
  private pendingPersist?: Promise<void>;

  constructor(options: StateStoreOptions = {}) {
    this.backend = options.backend;
  }

  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  async hydrate() {
    if (this.hydrated || !this.backend) {
      this.hydrated = true;
      return;
    }

    try {
      const snapshot = await this.backend.load();
      if (snapshot) {
        for (const [bookId, data] of Object.entries(snapshot)) {
          this.sessions.set(bookId, {
            bookId,
            lastLocation: data.lastLocation,
            bookmarks: Array.isArray(data.bookmarks) ? [...data.bookmarks] : [],
          });
        }
      }
    } catch (error) {
      console.warn("[state-store] Failed to hydrate reading state", error);
    } finally {
      this.hydrated = true;
    }
  }

  async saveProgress(bookId: string, location: PageLocator) {
    await this.ensureHydrated();
    const session = this.ensureSession(bookId);
    session.lastLocation = location;
    this.events.emit("progress:updated", { bookId, location });
    await this.persist();
  }

  async loadProgress(bookId: string): Promise<PageLocator | undefined> {
    await this.ensureHydrated();
    return this.sessions.get(bookId)?.lastLocation;
  }

  async addBookmark(bookId: string, location: PageLocator) {
    await this.ensureHydrated();
    const session = this.ensureSession(bookId);
    session.bookmarks.push(location);
    this.events.emit("bookmark:added", { bookId, location });
    await this.persist();
  }

  async listBookmarks(bookId: string): Promise<PageLocator[]> {
    await this.ensureHydrated();
    const session = this.sessions.get(bookId);
    return session ? [...session.bookmarks] : [];
  }

  snapshot(): StateSnapshot {
    const output: StateSnapshot = {};
    for (const [bookId, session] of this.sessions.entries()) {
      output[bookId] = {
        lastLocation: session.lastLocation,
        bookmarks: [...session.bookmarks],
      };
    }
    return output;
  }

  private ensureSession(bookId: string): ReadingSessionState {
    if (!this.sessions.has(bookId)) {
      this.sessions.set(bookId, {
        bookId,
        bookmarks: [],
      });
    }
    return this.sessions.get(bookId)!;
  }

  private async ensureHydrated() {
    if (!this.hydrated) {
      await this.hydrate();
    }
  }

  private async persist() {
    if (!this.backend) {
      return;
    }
    try {
      const snapshot = this.snapshot();
      this.pendingPersist = this.backend.save(snapshot);
      await this.pendingPersist;
    } catch (error) {
      console.error("[state-store] Failed to persist reading state", error);
    } finally {
      if (this.pendingPersist) {
        this.pendingPersist = undefined;
      }
    }
  }
}

const DEFAULT_STORAGE_KEY = "bkai.reader.state.v1";

export interface BrowserStateStoreOptions {
  storageKey?: string;
  preferIndexedDb?: boolean;
}

export async function createBrowserStateStore(options: BrowserStateStoreOptions = {}) {
  if (typeof window === "undefined") {
    return new InMemoryStateStore();
  }

  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const preferIndexedDb = options.preferIndexedDb ?? true;
  let backend: StateStoreBackend | undefined;

  if (preferIndexedDb && "indexedDB" in window) {
    try {
      backend = await createIndexedDbBackend({ dbName: storageKey });
    } catch (error) {
      console.warn("[state-store] Failed to initialize IndexedDB backend, falling back to localStorage", error);
    }
  }

  if (!backend) {
    backend = createLocalStorageBackend({ storageKey });
  }

  return new InMemoryStateStore({ backend });
}

export {
  IndexedDbBackend,
  LocalStorageBackend,
  createIndexedDbBackend,
  createLocalStorageBackend,
};

export type { StateStoreBackend, PageLocator, ReadingSessionState, StateSnapshot };
