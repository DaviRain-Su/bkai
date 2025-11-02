import { StateSnapshot, StateStoreBackend } from "../types";

export interface LocalStorageOptions {
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "bkai.reader.state.v1";

export class LocalStorageBackend implements StateStoreBackend {
  private readonly storageKey: string;

  constructor(options: LocalStorageOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  }

  async load(): Promise<StateSnapshot | undefined> {
    if (typeof window === "undefined") {
      return undefined;
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as StateSnapshot;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (error) {
      console.warn("[state-store] localStorage load failed", error);
    }
    return undefined;
  }

  async save(snapshot: StateSnapshot): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const serialized = JSON.stringify(snapshot);
      window.localStorage.setItem(this.storageKey, serialized);
    } catch (error) {
      console.warn("[state-store] localStorage save failed", error);
    }
  }
}

export function createLocalStorageBackend(options: LocalStorageOptions = {}) {
  return new LocalStorageBackend(options);
}
