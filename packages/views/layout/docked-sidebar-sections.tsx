"use client";

import { useEffect, type ReactNode } from "react";
import { useDockedLayoutStore, type DockedSidebarSection } from "@multica/core/chat/docked-layout-store";
import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

const SECTIONS: DockedSidebarSection[] = ["menu", "projects", "settings"];

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * The section the docked sidebar shows. The settings route always shows the
 * settings section; leaving it returns to the menu.
 */
export function useDockedSidebarSection(): DockedSidebarSection {
  const { pathname } = useNavigation();
  const settingsPath = useWorkspacePaths().settings();
  const section = useDockedLayoutStore((s) => s.sidebarSection);
  const setSection = useDockedLayoutStore((s) => s.setSidebarSection);
  const onSettings = isUnder(pathname, settingsPath);

  useEffect(() => {
    if (onSettings && section !== "settings") setSection("settings");
    if (!onSettings && section === "settings") setSection("menu");
  }, [onSettings, section, setSection]);

  return onSettings ? "settings" : section === "settings" ? "menu" : section;
}

/** Tab strip above the sidebar content: menu, project tree, settings. */
export function DockedSidebarTabs({ active }: { active: DockedSidebarSection }) {
  const { t } = useT("layout");
  const { push } = useNavigation();
  const settingsPath = useWorkspacePaths().settings();
  const setSection = useDockedLayoutStore((s) => s.setSidebarSection);
  const label = (section: DockedSidebarSection) =>
    section === "menu"
      ? t(($) => $.docked.menu)
      : section === "projects"
        ? t(($) => $.docked.projects)
        : t(($) => $.docked.settings);

  return (
    <div role="tablist" aria-label={t(($) => $.docked.sections)} className="flex gap-1 px-2 pb-2">
      {SECTIONS.map((section) => (
        <button
          key={section}
          type="button"
          role="tab"
          aria-selected={active === section}
          onClick={() => {
            setSection(section);
            if (section === "settings" && active !== "settings") push(settingsPath);
          }}
          className={cn(
            "h-7 min-w-0 flex-1 whitespace-nowrap rounded-md px-1 text-caption transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            active === section
              ? "bg-surface-selected font-medium text-surface-selected-foreground"
              : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          {label(section)}
        </button>
      ))}
    </div>
  );
}

/** Body of the project tree section until a repository source is connected. */
export function DockedProjectTree() {
  const { t } = useT("layout");
  return (
    <div className="px-4 py-6 text-caption text-muted-foreground">
      {t(($) => $.docked.projects_empty)}
    </div>
  );
}

/**
 * Body of the settings section: the element the settings page renders its
 * navigation into.
 */
export function DockedSettingsNavHost() {
  const setTarget = useDockedLayoutStore((s) => s.setSettingsNavTarget);
  return <div ref={setTarget} data-slot="docked-settings-nav" className="flex min-h-0 flex-1 flex-col" />;
}

/** Body for a section other than the menu, which keeps the sidebar's own nav. */
export function dockedSectionBody(active: Exclude<DockedSidebarSection, "menu">): ReactNode {
  return active === "projects" ? <DockedProjectTree /> : <DockedSettingsNavHost />;
}
