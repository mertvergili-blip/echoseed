/**
 * Persistence abstraction. Uses Tauri Store when running inside Tauri,
 * otherwise falls back to localStorage so the browser build is fully usable.
 */

const KEY = "echoseed-save";
/** Exported for tests that need to poke the underlying storage directly. */
export const STORAGE_KEY = KEY;

/**
 * Distinguishes "nothing has ever been saved" (first launch — no warning
 * needed) from "a save exists but couldn't be read" (corruption — the
 * caller must tell the user, not silently start a fresh world as if nothing
 * happened). Collapsing these into a single `null`/falsy result was a real
 * bug: a truncated or hand-edited save file used to look identical to a
 * first launch, so the app would quietly start over with no indication the
 * previous world was lost.
 */
export type LoadOutcome =
  | { status: "empty" }
  | { status: "corrupt" }
  | { status: "ok"; data: unknown };

interface StorageBackend {
  get(): Promise<LoadOutcome>;
  set(value: unknown): Promise<void>;
  clear(): Promise<void>;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

class LocalStorageBackend implements StorageBackend {
  async get(): Promise<LoadOutcome> {
    let raw: string | null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      // Storage itself is inaccessible (disabled, sandboxed, etc.) — there is
      // nothing to recover, so this is equivalent to a first launch.
      return { status: "empty" };
    }
    if (!raw) return { status: "empty" };
    try {
      return { status: "ok", data: JSON.parse(raw) };
    } catch {
      return { status: "corrupt" };
    }
  }
  async set(value: unknown): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch (e) {
      console.warn("localStorage save failed", e);
    }
  }
  async clear(): Promise<void> {
    localStorage.removeItem(KEY);
  }
}

class TauriStoreBackend implements StorageBackend {
  private storePromise: Promise<any> | null = null;

  private async store() {
    if (!this.storePromise) {
      this.storePromise = (async () => {
        const mod = await import("@tauri-apps/plugin-store");
        // Tauri Store persists to a JSON file in the app data dir.
        return await mod.load("echoseed.store.json", { autoSave: false });
      })();
    }
    return this.storePromise;
  }

  async get(): Promise<LoadOutcome> {
    try {
      const s = await this.store();
      const data = await s.get(KEY);
      if (data === undefined || data === null) return { status: "empty" };
      return { status: "ok", data };
    } catch (e) {
      console.warn("Tauri store get failed, falling back", e);
      // The store file itself may be unreadable (e.g. truncated by an
      // unclean shutdown mid-write). We can't tell that apart from "no store
      // file yet" through this API, so try the localStorage fallback; if
      // that's also empty we still can't be sure nothing was lost, so we
      // conservatively report "corrupt" rather than assuming a first launch.
      const fallback = await new LocalStorageBackend().get();
      if (fallback.status === "ok") return fallback;
      return { status: "corrupt" };
    }
  }
  async set(value: unknown): Promise<void> {
    try {
      const s = await this.store();
      await s.set(KEY, value);
      await s.save();
    } catch (e) {
      console.warn("Tauri store set failed, falling back", e);
      await new LocalStorageBackend().set(value);
    }
  }
  async clear(): Promise<void> {
    try {
      const s = await this.store();
      await s.delete(KEY);
      await s.save();
    } catch {
      /* ignore */
    }
  }
}

const backend: StorageBackend = isTauri() ? new TauriStoreBackend() : new LocalStorageBackend();

export const storage = {
  load: (): Promise<LoadOutcome> => backend.get(),
  save: (value: unknown) => backend.set(value),
  clear: () => backend.clear(),
  isTauri,
};
