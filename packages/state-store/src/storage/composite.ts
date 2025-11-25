import type { StateSnapshot, StateStoreBackend } from "../types";

export interface CompositeBackendOptions {
  primary: StateStoreBackend;
  fallback: StateStoreBackend;
}

export class CompositeBackend implements StateStoreBackend {
  private readonly primary: StateStoreBackend;
  private readonly fallback: StateStoreBackend;

  constructor(options: CompositeBackendOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
  }

  async load(): Promise<StateSnapshot | undefined> {
    const fallbackSnapshot = await this.fallback.load();

    try {
      const snapshot = await this.primary.load();
      if (snapshot) {
        // Keep fallback in sync when cloud succeeds
        await this.fallback.save(snapshot);
        return snapshot;
      }
    } catch (error) {
      console.warn("[state-store] composite primary load failed, using fallback", error);
    }

    return fallbackSnapshot;
  }

  async save(snapshot: StateSnapshot): Promise<void> {
    await this.fallback.save(snapshot);

    try {
      await this.primary.save(snapshot);
    } catch (error) {
      console.warn("[state-store] composite primary save failed", error);
    }
  }
}

export function createCompositeBackend(options: CompositeBackendOptions) {
  return new CompositeBackend(options);
}
