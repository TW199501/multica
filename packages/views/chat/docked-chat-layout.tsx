"use client";

import { useLayoutEffect, type ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { useChatStore } from "@multica/core/chat";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { useWorkspacePaths } from "@multica/core/paths";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@multica/ui/components/ui/resizable";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { useNavigation } from "../navigation";
import { ChatWindow } from "./components/chat-window";
import { isFloatingChatRouteSuppressed } from "./floating-chat-visibility";

export interface DockedChatLayoutProps {
  /** False until the shell has a resolved workspace; the page then renders alone. */
  enabled?: boolean;
  /**
   * Extra routes (besides the built-in page-first ones) whose page takes the
   * middle column, with the conversation on the right; matched as the path or
   * its sub-paths.
   */
  pageFirstPaths?: readonly string[];
  children: ReactNode;
}

/**
 * With the floating chat preference off, the conversation gets its own column
 * in the middle and the current page moves to a resizable column on the right;
 * on Settings, Inbox, an open project, the AI team pages, Usage, `pageFirstPaths` and while the
 * project tree tab is open, the page stays in the middle and the conversation takes the right. With it on, on
 * the Chat tab and on small screens, the page renders as before. An open project or issue with the project tree
 * tab open takes the right column for its properties and code, and the conversation stays hidden until the tab
 * changes.
 */
export function DockedChatLayout({ enabled = true, pageFirstPaths, children }: DockedChatLayoutProps) {
  if (!enabled) return <>{children}</>;
  return (
    <DockedChatLayoutForWorkspace pageFirstPaths={pageFirstPaths}>{children}</DockedChatLayoutForWorkspace>
  );
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function DockedChatLayoutForWorkspace({
  pageFirstPaths = [],
  children,
}: {
  pageFirstPaths?: readonly string[];
  children: ReactNode;
}) {
  const floating = useChatStore((s) => s.floatingChatEnabled);
  const { pathname } = useNavigation();
  const wsPaths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const settingsPath = wsPaths.settings();
  // Wide management pages keep the middle column; work pages put the
  // conversation there.
  const sidebarSection = useDockedLayoutStore((s) => s.sidebarSection);
  const pageFirst = [
    settingsPath,
    wsPaths.inbox(),
    wsPaths.agents(),
    wsPaths.squads(),
    wsPaths.workflows(),
    wsPaths.skills(),
    wsPaths.runtimes(),
    wsPaths.usage(),
    ...pageFirstPaths,
  ].some((base) => isUnder(pathname, base)) ||
    // An open project is a wide table; the project list stays a work page.
    pathname.startsWith(`${wsPaths.projects()}/`) ||
    // The project tree is for working through tasks, so the task leads there.
    sidebarSection === "projects";
  // Pages carry split panes of their own (issue properties, the Inbox list
  // beside an issue), so the page column never shrinks below what they need.
  const pageMinSize = isUnder(pathname, wsPaths.inbox()) ? "780px" : "540px";
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: pageFirst ? "multica_docked_chat_layout_page_first_v3" : "multica_docked_chat_layout_v2",
  });
  const shellDocked = !floating && !isMobile;
  const active = shellDocked && !isFloatingChatRouteSuppressed(pathname, wsPaths.chat());
  const setLayoutActive = useDockedLayoutStore((s) => s.setLayoutActive);
  const setShellDocked = useDockedLayoutStore((s) => s.setShellDocked);
  const setPageElement = useDockedLayoutStore((s) => s.setPageElement);
  const setAsideElement = useDockedLayoutStore((s) => s.setAsideElement);
  const projectAside =
    sidebarSection === "projects" &&
    (pathname.startsWith(`${wsPaths.projects()}/`) || pathname.startsWith(`${wsPaths.issues()}/`));

  useLayoutEffect(() => {
    setShellDocked(shellDocked);
    return () => setShellDocked(false);
  }, [shellDocked, setShellDocked]);

  useLayoutEffect(() => {
    setLayoutActive(active);
    return () => setLayoutActive(false);
  }, [active, setLayoutActive]);

  if (!active) {
    return <>{children}</>;
  }

  const conversation = (
    <ResizablePanel
      key="conversation"
      id="conversation"
      defaultSize="32%"
      minSize="360px"
    >
      <div className={pageFirst ? "h-full border-l" : "h-full border-r"}>
        {projectAside && (
          <div ref={setAsideElement} data-slot="docked-aside" className="flex h-full min-h-0 flex-col" />
        )}
        {/* Hidden, not unmounted: returning to the conversation keeps its scroll position. */}
        <div hidden={projectAside} className="h-full">
          <ChatWindow variant="docked" />
        </div>
      </div>
    </ResizablePanel>
  );
  const page = (
    <ResizablePanel key="page" id="page" defaultSize="68%" minSize={pageMinSize}>
      <div
        ref={setPageElement}
        data-slot="docked-page"
        className="relative flex h-full min-w-0 flex-col overflow-hidden"
      >
        {children}
      </div>
    </ResizablePanel>
  );

  // Page-first routes keep their content in the middle and move the
  // conversation to the third column; every other page sits beside it.
  return (
    <ResizablePanelGroup
      key={pageFirst ? "page-first" : "conversation-first"}
      orientation="horizontal"
      className="min-h-0 min-w-0 flex-1 overflow-hidden"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {pageFirst ? page : conversation}
      <ResizableHandle />
      {pageFirst ? conversation : page}
    </ResizablePanelGroup>
  );
}
