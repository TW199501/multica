"use client";

import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { useSidebarSafe } from "@multica/ui/components/ui/sidebar";
import { cn } from "@multica/ui/lib/utils";
import { PANEL_ROW_CLASS, panelRowAnchor, panelRowStateClass } from "./panel-nav";

export interface DockedSettingsNav {
  /** The sidebar element the settings navigation renders into; null keeps it in the page. */
  target: HTMLElement | null;
  /** The page renders no navigation of its own: the docked sidebar holds it. */
  hidePageNav: boolean;
  /** The page navigation stays expanded while the shell's list column is collapsed. */
  keepPageNavOpen: boolean;
}

/**
 * Where the settings navigation goes in the docked layout. The sidebar's
 * settings section holds it while the space panel is on screen; with the
 * panel collapsed or at compact widths it falls back to the page, expanded.
 */
export function useDockedSettingsNav(): DockedSettingsNav {
  const layoutActive = useDockedLayoutStore((s) => s.layoutActive);
  const settingsNavTarget = useDockedLayoutStore((s) => s.settingsNavTarget);
  const sidebar = useSidebarSafe();
  const spacePanelHidden = !!sidebar && (!sidebar.open || sidebar.isCompact);
  return {
    target: spacePanelHidden ? null : settingsNavTarget,
    hidePageNav: layoutActive && !spacePanelHidden,
    keepPageNavOpen: layoutActive,
  };
}

/** A settings row inside the docked sidebar, styled as a space panel row. */
export function dockedSettingsRowProps(active: boolean) {
  return {
    ...panelRowAnchor(active),
    className: cn(PANEL_ROW_CLASS, panelRowStateClass(active)),
  };
}
