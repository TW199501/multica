"use client";

import { create } from "zustand";

/** Sections the sidebar switches between in the docked layout, in tab order. */
export type DockedSidebarSection = "menu" | "projects" | "settings";

interface DockedLayoutState {
  sidebarSection: DockedSidebarSection;
  setSidebarSection: (section: DockedSidebarSection) => void;
  /**
   * The sidebar element the settings page renders its own navigation into.
   * Null while the settings section is not on screen.
   */
  settingsNavTarget: HTMLElement | null;
  setSettingsNavTarget: (target: HTMLElement | null) => void;
  /** True while the docked layout is on screen. */
  layoutActive: boolean;
  setLayoutActive: (active: boolean) => void;
  /**
   * The docked page column, for overlays drawn outside it (the desktop
   * browser) that must cover only that column.
   */
  pageElement: HTMLElement | null;
  setPageElement: (element: HTMLElement | null) => void;
}

export const useDockedLayoutStore = create<DockedLayoutState>()((set) => ({
  sidebarSection: "menu",
  setSidebarSection: (sidebarSection) => set({ sidebarSection }),
  settingsNavTarget: null,
  setSettingsNavTarget: (settingsNavTarget) => set({ settingsNavTarget }),
  layoutActive: false,
  setLayoutActive: (layoutActive) => set({ layoutActive }),
  pageElement: null,
  setPageElement: (pageElement) => set({ pageElement }),
}));
