/**
 * Persistence abstraction. Uses Tauri Store when running inside Tauri,
 * otherwise falls back to localStorage so the browser build is fully usable.
 */

const KEY = "echoseed-save";

interface StorageBackend {
  get(): Promise<unknown>;
  set(value: unknown): Promise<void>;
  clear(): Promise<void>;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

class LocalStorageBackend implements StorageBackend {
  async get(): Promise<unknown> {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
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

  async get(): Promise<unknown> {
    try {
      const s = await this.store();
      return (await s.get(KEY)) ?? null;
    } catch (e) {
      console.warn("Tauri store get failed, falling back", e);
      return new LocalStorageBackend().get();
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
  load: () => backend.get(),
  save: (value: unknown) => backend.set(value),
  clear: () => backend.clear(),
  isTauri,
};
