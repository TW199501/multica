"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { useDockedLayoutStore, type DockedSidebarSection } from "@multica/core/chat/docked-layout-store";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@multica/ui/components/ui/resizable";
import { cn } from "@multica/ui/lib/utils";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";

const SECTIONS: DockedSidebarSection[] = ["menu", "projects", "settings"];

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * The section the docked sidebar shows. Entering the settings route opens the
 * settings section; the other tabs stay selectable while on it, and leaving
 * the route returns to the menu.
 */
export function useDockedSidebarSection(): DockedSidebarSection {
  const { pathname } = useNavigation();
  const settingsPath = useWorkspacePaths().settings();
  const section = useDockedLayoutStore((s) => s.sidebarSection);
  const setSection = useDockedLayoutStore((s) => s.setSidebarSection);
  const onSettings = isUnder(pathname, settingsPath);
  const [enteredSettings, setEnteredSettings] = useState(false);

  useEffect(() => {
    if (onSettings && !enteredSettings) {
      setEnteredSettings(true);
      setSection("settings");
    }
    if (!onSettings) {
      if (enteredSettings) setEnteredSettings(false);
      if (section === "settings") setSection("menu");
    }
  }, [onSettings, enteredSettings, section, setSection]);

  if (onSettings && !enteredSettings) return "settings";
  if (!onSettings && section === "settings") return "menu";
  return section;
}

/** Tab strip above the sidebar content: menu, project tree, settings. */
export function DockedSidebarTabs({ active }: { active: DockedSidebarSection }) {
  const { t } = useT("layout");
  const { push, pathname } = useNavigation();
  const settingsPath = useWorkspacePaths().settings();
  const setSection = useDockedLayoutStore((s) => s.setSidebarSection);
  const onSettings = isUnder(pathname, settingsPath);
  const label = (section: DockedSidebarSection) =>
    section === "menu"
      ? t(($) => $.docked.menu)
      : section === "projects"
        ? t(($) => $.docked.projects)
        : t(($) => $.docked.settings);

  return (
    <div role="tablist" aria-label={t(($) => $.docked.sections)} className="flex gap-1">
      {SECTIONS.map((section) => (
        <button
          key={section}
          type="button"
          role="tab"
          aria-selected={active === section}
          onClick={() => {
            setSection(section);
            if (section === "settings" && !onSettings) push(settingsPath);
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

/**
 * Body of the projects section: pinned items on top (25%) and the file
 * explorer below (75%), each scrolling on its own. The explorer stays empty
 * until a repository source is connected.
 */
export function DockedProjectTree({ pinned }: { pinned?: ReactNode }) {
  const { t } = useT("layout");
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: "multica_docked_projects_split" });
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 flex-1"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id="pinned" defaultSize="25%" minSize="10%">
        <section aria-label={t(($) => $.sidebar.pinned_label)} className="flex h-full min-h-0 flex-col">
          <h2 className="px-4 pb-1 pt-2 text-caption font-medium text-muted-foreground">
            {t(($) => $.sidebar.pinned_label)}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {pinned ?? (
              <p className="px-2 py-1 text-caption text-muted-foreground">{t(($) => $.docked.pinned_empty)}</p>
            )}
          </div>
        </section>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="explorer" defaultSize="75%" minSize="25%">
        <section aria-label={t(($) => $.docked.explorer)} className="flex h-full min-h-0 flex-col">
          <h2 className="px-4 pb-1 pt-2 text-caption font-medium text-muted-foreground">
            {t(($) => $.docked.explorer)}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 text-caption text-muted-foreground">
            {t(($) => $.docked.projects_empty)}
          </div>
        </section>
      </ResizablePanel>
    </ResizablePanelGroup>
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
export function dockedSectionBody(
  active: Exclude<DockedSidebarSection, "menu">,
  { pinned }: { pinned?: ReactNode } = {},
): ReactNode {
  return active === "projects" ? <DockedProjectTree pinned={pinned} /> : <DockedSettingsNavHost />;
}
