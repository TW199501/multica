"use client";

import { create } from "zustand";

/** Sections the sidebar switches between in the docked layout, in tab order. */
export type DockedSidebarSection = "menu" | "projects" | "settings";

/** The file the project tree last opened. A new object on every click. */
export interface DockedCodeSelection {
  projectId: string;
  resourceId: string;
  path: string;
}

/** Unsaved text of the file being edited; null while no file is in edit mode. */
export interface DockedCodeDraft {
  projectId: string;
  path: string;
  content: string;
}

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
   * True while the shell uses the docked chrome (status bar, shortened
   * sidebar): floating chat is off on a wide screen. Unlike `layoutActive`,
   * it stays on for the Chat tab, which hides only the conversation columns.
   */
  shellDocked: boolean;
  setShellDocked: (docked: boolean) => void;
  /**
   * The docked page column, for overlays drawn outside it (the desktop
   * browser) that must cover only that column.
   */
  pageElement: HTMLElement | null;
  setPageElement: (element: HTMLElement | null) => void;
  /**
   * The right column an open project renders its properties and code into
   * while the project tree tab is open. Null otherwise.
   */
  asideElement: HTMLElement | null;
  setAsideElement: (element: HTMLElement | null) => void;
  codeSelection: DockedCodeSelection | null;
  setCodeSelection: (selection: DockedCodeSelection | null) => void;
  codeDraft: DockedCodeDraft | null;
  setCodeDraft: (draft: DockedCodeDraft | null) => void;
}

export const useDockedLayoutStore = create<DockedLayoutState>()((set) => ({
  sidebarSection: "menu",
  setSidebarSection: (sidebarSection) => set({ sidebarSection }),
  settingsNavTarget: null,
  setSettingsNavTarget: (settingsNavTarget) => set({ settingsNavTarget }),
  layoutActive: false,
  setLayoutActive: (layoutActive) => set({ layoutActive }),
  shellDocked: false,
  setShellDocked: (shellDocked) => set({ shellDocked }),
  pageElement: null,
  setPageElement: (pageElement) => set({ pageElement }),
  asideElement: null,
  setAsideElement: (asideElement) => set({ asideElement }),
  codeSelection: null,
  setCodeSelection: (codeSelection) => set({ codeSelection }),
  codeDraft: null,
  setCodeDraft: (codeDraft) => set({ codeDraft }),
}));
