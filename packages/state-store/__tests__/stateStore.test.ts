import { describe, expect, it } from "bun:test";
import { InMemoryStateStore, StateSnapshot } from "@state-store";

describe("InMemoryStateStore", () => {
  it("hydrates from snapshot and persists changes", async () => {
    const initial: StateSnapshot = {
      book_a: {
        lastLocation: { spineIndex: 2, offset: 5 },
        bookmarks: [{ spineIndex: 1, offset: 0 }],
      },
    };

    let persisted: StateSnapshot | undefined;
    const store = new InMemoryStateStore({
      initialSnapshot: initial,
      onChange: snapshot => {
        persisted = snapshot;
      },
    });

    const progress = await store.loadProgress("book_a");
    expect(progress).toEqual({ spineIndex: 2, offset: 5 });

    await store.saveProgress("book_a", { spineIndex: 3, offset: 10 });
    expect(persisted?.book_a?.lastLocation).toEqual({ spineIndex: 3, offset: 10 });

    await store.addBookmark("book_b", { spineIndex: 0, offset: 1 });
    expect(persisted?.book_b?.bookmarks).toEqual([{ spineIndex: 0, offset: 1 }]);
  });
});
