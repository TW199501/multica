"use client";

import { create } from "zustand";

/** Sections the sidebar switches between in the docked layout, in tab order. */
export type DockedSidebarSection = "menu" | "projects" | "settings";

interface DockedLayoutState {
  sidebarSection: DockedSidebarSection;
  setSidebarSection: (section: DockedSidebarSection) => void;
  /**
   * The sidebar element the settings page renders its own navigation into.
   * Null while the settings section is not on screen; the page then keeps its
   * navigation inline.
   */
  settingsNavTarget: HTMLElement | null;
  setSettingsNavTarget: (target: HTMLElement | null) => void;
}

export const useDockedLayoutStore = create<DockedLayoutState>()((set) => ({
  sidebarSection: "menu",
  setSidebarSection: (sidebarSection) => set({ sidebarSection }),
  settingsNavTarget: null,
  setSettingsNavTarget: (settingsNavTarget) => set({ settingsNavTarget }),
}));
