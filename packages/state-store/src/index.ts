import { EventBus } from "@core-platform";

export interface PageLocator {
  spineIndex: number;
  offset: number;
}

export interface ReadingSessionState {
  bookId: string;
  lastLocation?: PageLocator;
  bookmarks: PageLocator[];
}

export type StateEvents = {
  "progress:updated": { bookId: string; location: PageLocator };
  "bookmark:added": { bookId: string; location: PageLocator };
};

export type StateSnapshot = Record<string, Omit<ReadingSessionState, "bookId">>;

export interface StateStoreOptions {
  initialSnapshot?: StateSnapshot;
  onChange?: (snapshot: StateSnapshot) => void | Promise<void>;
}

export class InMemoryStateStore {
  private readonly sessions = new Map<string, ReadingSessionState>();
  private readonly events = new EventBus<StateEvents>();
  private readonly onChange?: (snapshot: StateSnapshot) => void | Promise<void>;

  constructor(options: StateStoreOptions = {}) {
    this.onChange = options.onChange;

    if (options.initialSnapshot) {
      for (const [bookId, data] of Object.entries(options.initialSnapshot)) {
        this.sessions.set(bookId, {
          bookId,
          lastLocation: data.lastLocation,
          bookmarks: Array.isArray(data.bookmarks) ? [...data.bookmarks] : [],
        });
      }
    }
  }

  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  async saveProgress(bookId: string, location: PageLocator) {
    const session = this.ensureSession(bookId);
    session.lastLocation = location;
    this.events.emit("progress:updated", { bookId, location });
    await this.persist();
  }

  async loadProgress(bookId: string): Promise<PageLocator | undefined> {
    return this.sessions.get(bookId)?.lastLocation;
  }

  async addBookmark(bookId: string, location: PageLocator) {
    const session = this.ensureSession(bookId);
    session.bookmarks.push(location);
    this.events.emit("bookmark:added", { bookId, location });
    await this.persist();
  }

  async listBookmarks(bookId: string): Promise<PageLocator[]> {
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

  private async persist() {
    if (!this.onChange) {
      return;
    }
    try {
      await this.onChange(this.snapshot());
    } catch (error) {
      console.error("[state-store] Failed to persist reading state", error);
    }
  }
}

const DEFAULT_STORAGE_KEY = "bkai.reader.state.v1";

export function createBrowserStateStore(storageKey = DEFAULT_STORAGE_KEY) {
  if (typeof window === "undefined") {
    return new InMemoryStateStore();
  }

  let initialSnapshot: StateSnapshot | undefined;

  try {
    const cached = window.localStorage.getItem(storageKey);
    if (cached) {
      const parsed = JSON.parse(cached) as StateSnapshot;
      if (parsed && typeof parsed === "object") {
        initialSnapshot = parsed;
      }
    }
  } catch (error) {
    console.warn("[state-store] Failed to load reading state from localStorage", error);
  }

  return new InMemoryStateStore({
    initialSnapshot,
    onChange: snapshot => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch (error) {
        console.warn("[state-store] Failed to persist reading state to localStorage", error);
      }
    },
  });
}
