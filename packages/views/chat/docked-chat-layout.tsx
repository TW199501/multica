"use client";

import { useEffect, type ReactNode } from "react";
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
   * Extra routes (besides Settings and Inbox) whose page takes the middle column, with
   * the conversation on the right; matched as the path or its sub-paths.
   */
  pageFirstPaths?: readonly string[];
  children: ReactNode;
}

/**
 * With the floating chat preference off, the conversation gets its own column
 * in the middle and the current page moves to a resizable column on the right;
 * on Settings, Inbox and `pageFirstPaths` the page stays in the middle and the
 * conversation takes the right. With it on, on the Chat tab and on small screens, the page renders as
 * before.
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
  const pageFirst = [settingsPath, wsPaths.inbox(), ...pageFirstPaths].some((base) =>
    isUnder(pathname, base),
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: pageFirst ? "multica_docked_chat_layout_page_first_v3" : "multica_docked_chat_layout_v2",
  });
  const active = !floating && !isMobile && !isFloatingChatRouteSuppressed(pathname, wsPaths.chat());
  const setLayoutActive = useDockedLayoutStore((s) => s.setLayoutActive);
  const setPageElement = useDockedLayoutStore((s) => s.setPageElement);

  useEffect(() => {
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
      minSize="30%"
    >
      <div className={pageFirst ? "h-full border-l pb-[30px]" : "h-full border-r pb-[30px]"}>
        <ChatWindow variant="docked" />
      </div>
    </ResizablePanel>
  );
  const page = (
    <ResizablePanel key="page" id="page" defaultSize="68%" minSize="25%">
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
      className="flex-1 min-h-0"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      {pageFirst ? page : conversation}
      <ResizableHandle />
      {pageFirst ? conversation : page}
    </ResizablePanelGroup>
  );
}
