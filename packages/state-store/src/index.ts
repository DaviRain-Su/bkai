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

export class InMemoryStateStore {
  private readonly sessions = new Map<string, ReadingSessionState>();
  private readonly events = new EventBus<StateEvents>();

  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  async saveProgress(bookId: string, location: PageLocator) {
    const session = this.ensureSession(bookId);
    session.lastLocation = location;
    this.events.emit("progress:updated", { bookId, location });
  }

  async loadProgress(bookId: string): Promise<PageLocator | undefined> {
    return this.sessions.get(bookId)?.lastLocation;
  }

  async addBookmark(bookId: string, location: PageLocator) {
    const session = this.ensureSession(bookId);
    session.bookmarks.push(location);
    this.events.emit("bookmark:added", { bookId, location });
  }

  async listBookmarks(bookId: string): Promise<PageLocator[]> {
    return this.sessions.get(bookId)?.bookmarks ?? [];
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
}
