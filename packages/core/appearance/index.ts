import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { defaultStorage } from "../platform/storage";
import type { StorageAdapter } from "../types/storage";

/** The accent palettes the UI can wear; "neutral" is the original monochrome. */
export const ACCENT_COLORS = ["neutral", "terracotta", "ocean"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const DEFAULT_ACCENT: AccentColor = "neutral";

/** localStorage key; also read by the web layout's pre-paint script. */
export const ACCENT_STORAGE_KEY = "multica:appearance:accent";

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && (ACCENT_COLORS as readonly string[]).includes(value);
}

/**
 * Inline script for the start of <body>: applies a stored accent before first
 * paint, so a non-default choice does not flash the default.
 */
export const ACCENT_PREPAINT_SCRIPT = `try{var a=localStorage.getItem(${JSON.stringify(
  ACCENT_STORAGE_KEY,
)});if(${JSON.stringify(ACCENT_COLORS)}.indexOf(a)>=0)document.documentElement.dataset.accent=a}catch(e){}`;

interface AccentState {
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
}

/** A device-scoped accent preference, persisted through the storage adapter. */
export function createAccentStore(storage: StorageAdapter = defaultStorage): StoreApi<AccentState> {
  const stored = storage.getItem(ACCENT_STORAGE_KEY);
  return createStore<AccentState>((set) => ({
    accent: isAccentColor(stored) ? stored : DEFAULT_ACCENT,
    setAccent: (accent) => {
      storage.setItem(ACCENT_STORAGE_KEY, accent);
      set({ accent });
    },
  }));
}

export const accentStore = createAccentStore();

export function useAccentStore(): AccentState;
export function useAccentStore<T>(selector: (state: AccentState) => T): T;
export function useAccentStore<T>(selector?: (state: AccentState) => T) {
  return useStore(accentStore, selector as (state: AccentState) => T);
}
