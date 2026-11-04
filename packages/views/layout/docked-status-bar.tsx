"use client";

import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";

/** Fixed 30px bar under the whole window while the docked chat layout is on screen. */
export function DockedStatusBar() {
  const layoutActive = useDockedLayoutStore((s) => s.layoutActive);
  if (!layoutActive) return null;
  return (
    <footer
      data-slot="docked-status-bar"
      className="h-[30px] shrink-0 border-t border-sidebar-border bg-sidebar"
    />
  );
}
