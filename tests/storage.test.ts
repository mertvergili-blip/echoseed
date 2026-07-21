import { describe, it, expect, beforeEach } from "vitest";

/**
 * storage.ts targets a browser/Tauri runtime and reads `window`/`localStorage`
 * at module-load time, neither of which exist in the default Node test
 * environment. A minimal in-memory polyfill lets us exercise the real
 * LocalStorageBackend code path (not a mock of storage.ts itself) without
 * pulling in jsdom for one module.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const mem = new MemoryStorage();
(globalThis as any).window = globalThis; // storage.ts's isTauri() checks `typeof window !== "undefined"`
(globalThis as any).localStorage = mem;

const { storage, STORAGE_KEY } = await import("../src/platform/storage");

describe("storage: empty vs corrupt vs ok", () => {
  beforeEach(() => {
    mem.clear();
  });

  it("reports 'empty' when nothing has ever been saved (genuine first launch)", async () => {
    const outcome = await storage.load();
    expect(outcome.status).toBe("empty");
  });

  it("reports 'ok' with the parsed data after a normal save", async () => {
    await storage.save({ hello: "world", n: 42 });
    const outcome = await storage.load();
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.data).toEqual({ hello: "world", n: 42 });
  });

  it("reports 'corrupt' — not 'empty' — when the stored value is not valid JSON", async () => {
    mem.setItem(STORAGE_KEY, "{this is not valid json!!!");
    const outcome = await storage.load();
    // This is the core regression guard: before this fix, a corrupt save
    // and a first launch both produced a falsy `null`, so the app silently
    // started a new world with no indication the old one was unreadable.
    expect(outcome.status).toBe("corrupt");
    expect(outcome.status).not.toBe("empty");
  });

  it("reports 'corrupt' for a JSON string truncated mid-write (simulated half-written save)", async () => {
    const full = JSON.stringify({ version: 1, world: { organisms: [1, 2, 3], seed: "abc" } });
    const truncated = full.slice(0, Math.floor(full.length * 0.6));
    mem.setItem(STORAGE_KEY, truncated);
    const outcome = await storage.load();
    expect(outcome.status).toBe("corrupt");
  });

  it("an empty string in storage is treated as 'empty', not 'corrupt'", async () => {
    mem.setItem(STORAGE_KEY, "");
    const outcome = await storage.load();
    expect(outcome.status).toBe("empty");
  });

  it("clear() removes the save so a subsequent load reports 'empty' again", async () => {
    await storage.save({ a: 1 });
    expect((await storage.load()).status).toBe("ok");
    await storage.clear();
    expect((await storage.load()).status).toBe("empty");
  });

  it("round-trips arbitrary JSON-serializable data exactly", async () => {
    const payload = { a: [1, 2, 3], b: { c: null, d: "text", e: 1.5 }, f: false };
    await storage.save(payload);
    const outcome = await storage.load();
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.data).toEqual(payload);
  });
});
