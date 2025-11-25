import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import type { StateSnapshot } from "@state-store";

const STATE_FILE = Bun.env.READING_STATE_FILE ?? "./data/reading_state.json";

type StoreShape = Record<string, StateSnapshot>;

let cache: StoreShape | null = null;
let writePromise: Promise<void> | null = null;

async function ensureLoaded() {
  if (cache) return;
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) {
      const raw = await file.text();
      cache = raw ? (JSON.parse(raw) as StoreShape) : {};
      return;
    }
  } catch (error) {
    console.warn("[server] Failed to read state file", error);
  }
  cache = {};
}

async function persist() {
  if (!cache) return;
  if (writePromise) {
    await writePromise;
    return;
  }

  const dir = dirname(STATE_FILE);
  writePromise = (async () => {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(STATE_FILE, JSON.stringify(cache, null, 2), "utf8");
    } catch (error) {
      console.warn("[server] Failed to persist reading state", error);
    } finally {
      writePromise = null;
    }
  })();

  await writePromise;
}

export async function getUserSnapshot(userId: string): Promise<StateSnapshot | undefined> {
  await ensureLoaded();
  if (!cache) return undefined;
  return cache[userId];
}

export async function setUserSnapshot(userId: string, snapshot: StateSnapshot) {
  await ensureLoaded();
  if (!cache) {
    cache = { [userId]: snapshot };
  } else {
    cache[userId] = snapshot;
  }
  await persist();
}
