"use client";

import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";

/** Fixed 30px bar under the whole window while the shell is docked, the Chat tab included. */
export function DockedStatusBar() {
  const shellDocked = useDockedLayoutStore((s) => s.shellDocked);
  if (!shellDocked) return null;
  return (
    <footer
      data-slot="docked-status-bar"
      className="h-[30px] shrink-0 border-t border-sidebar-border bg-sidebar"
    />
  );
}
