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
 * in the middle and the current page moves to a resizable column on the right.
 * With it on, on the Chat tab and on small screens, the page renders as before.
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
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_docked_chat_layout",
  });

  if (floating || isMobile || isFloatingChatRouteSuppressed(pathname, wsPaths.chat())) {
    return <>{children}</>;
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="flex-1 min-h-0"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id="conversation" defaultSize="50%" minSize="30%">
        <div className="h-full border-r">
          <ChatWindow variant="docked" />
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="page" defaultSize="50%" minSize="25%">
        <div data-slot="docked-page" className="relative flex h-full min-w-0 flex-col overflow-hidden">
          {children}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
