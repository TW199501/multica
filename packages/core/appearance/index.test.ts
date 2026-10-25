// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "../types/storage";
import { ACCENT_PREPAINT_SCRIPT, ACCENT_STORAGE_KEY, DEFAULT_ACCENT, createAccentStore, isAccentColor } from "./index";

function memoryStorage(initial: Record<string, string> = {}): StorageAdapter {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}

describe("accent store", () => {
  it("starts on the default accent with nothing stored", () => {
    expect(createAccentStore(memoryStorage()).getState().accent).toBe(DEFAULT_ACCENT);
  });

  it("restores a stored accent", () => {
    const store = createAccentStore(memoryStorage({ [ACCENT_STORAGE_KEY]: "ocean" }));
    expect(store.getState().accent).toBe("ocean");
  });

  it("ignores an unknown stored value", () => {
    const store = createAccentStore(memoryStorage({ [ACCENT_STORAGE_KEY]: "purple" }));
    expect(store.getState().accent).toBe(DEFAULT_ACCENT);
  });

  it("persists a change", () => {
    const storage = memoryStorage();
    const store = createAccentStore(storage);
    store.getState().setAccent("neutral");
    expect(store.getState().accent).toBe("neutral");
    expect(storage.getItem(ACCENT_STORAGE_KEY)).toBe("neutral");
  });

  it("recognises only the known accents", () => {
    expect(isAccentColor("terracotta")).toBe(true);
    expect(isAccentColor("ocean")).toBe(true);
    expect(isAccentColor("neutral")).toBe(true);
    expect(isAccentColor("purple")).toBe(false);
    expect(isAccentColor(null)).toBe(false);
  });
});

describe("ACCENT_PREPAINT_SCRIPT", () => {
  function run(stored: string | null) {
    const root = { dataset: {} as Record<string, string> };
    const fn = new Function("localStorage", "document", ACCENT_PREPAINT_SCRIPT);
    fn({ getItem: () => stored }, { documentElement: root });
    return root.dataset.accent;
  }

  it("applies a stored known accent", () => {
    expect(run("ocean")).toBe("ocean");
  });

  it("leaves the attribute unset otherwise", () => {
    expect(run(null)).toBeUndefined();
    expect(run("purple")).toBeUndefined();
  });
});
