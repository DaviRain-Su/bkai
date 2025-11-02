import { describe, expect, it } from "bun:test";
import { InMemoryStateStore } from "@state-store";
import type { StateSnapshot, StateStoreBackend } from "@state-store";

class MemoryBackend implements StateStoreBackend {
  private snapshot: StateSnapshot;

  constructor(initial: StateSnapshot) {
    this.snapshot = initial;
  }

  async load(): Promise<StateSnapshot | undefined> {
    return this.snapshot;
  }

  async save(snapshot: StateSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}

describe("InMemoryStateStore", () => {
  it("hydrates from snapshot and persists changes", async () => {
    const initial: StateSnapshot = {
      book_a: {
        lastLocation: { spineIndex: 2, offset: 5 },
        bookmarks: [{ spineIndex: 1, offset: 0 }],
      },
    };

    const backend = new MemoryBackend(initial);
    const store = new InMemoryStateStore({ backend });
    await store.hydrate();

    const progress = await store.loadProgress("book_a");
    expect(progress).toEqual({ spineIndex: 2, offset: 5 });

    await store.saveProgress("book_a", { spineIndex: 3, offset: 10 });
    expect((await backend.load())?.book_a?.lastLocation).toEqual({ spineIndex: 3, offset: 10 });

    await store.addBookmark("book_b", { spineIndex: 0, offset: 1 });
    expect((await backend.load())?.book_b?.bookmarks).toEqual([{ spineIndex: 0, offset: 1 }]);
  });
});
