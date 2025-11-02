export interface PageLocator {
  spineIndex: number;
  offset: number;
}

export interface ReadingSessionState {
  bookId: string;
  lastLocation?: PageLocator;
  bookmarks: PageLocator[];
}

export type StateSnapshot = Record<string, Omit<ReadingSessionState, "bookId">>;

export interface StateStoreBackend {
  load(): Promise<StateSnapshot | undefined>;
  save(snapshot: StateSnapshot): Promise<void>;
}
