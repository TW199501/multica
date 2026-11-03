"use client";

import type { ReactNode } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { useChatStore } from "@multica/core/chat";
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
  children: ReactNode;
}

/**
 * With the floating chat preference off, the conversation gets its own column
 * in the middle and the current page moves to a resizable column on the right;
 * on Settings the page stays in the middle and the conversation takes the
 * right. With it on, on the Chat tab and on small screens, the page renders as
 * before.
 */
export function DockedChatLayout({ enabled = true, children }: DockedChatLayoutProps) {
  if (!enabled) return <>{children}</>;
  return <DockedChatLayoutForWorkspace>{children}</DockedChatLayoutForWorkspace>;
}

function DockedChatLayoutForWorkspace({ children }: { children: ReactNode }) {
  const floating = useChatStore((s) => s.floatingChatEnabled);
  const { pathname } = useNavigation();
  const wsPaths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const settingsPath = wsPaths.settings();
  const pageFirst = pathname === settingsPath || pathname.startsWith(`${settingsPath}/`);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: pageFirst ? "multica_docked_chat_layout_page_first" : "multica_docked_chat_layout",
  });

  if (floating || isMobile || isFloatingChatRouteSuppressed(pathname, wsPaths.chat())) {
    return <>{children}</>;
  }

  const conversation = (
    <ResizablePanel key="conversation" id="conversation" defaultSize="50%" minSize="30%">
      <div className={pageFirst ? "h-full border-l" : "h-full border-r"}>
        <ChatWindow variant="docked" />
      </div>
    </ResizablePanel>
  );
  const page = (
    <ResizablePanel key="page" id="page" defaultSize="50%" minSize="25%">
      <div data-slot="docked-page" className="relative flex h-full min-w-0 flex-col overflow-hidden">
        {children}
      </div>
    </ResizablePanel>
  );

  // Settings keeps its content in the middle and moves the conversation to
  // the third column; every other page sits beside the conversation.
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
