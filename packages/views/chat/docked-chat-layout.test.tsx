// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { NavigationProvider, type NavigationAdapter } from "../navigation";

const chatState = { floatingChatEnabled: false };
const layout = { mobile: false };

vi.mock("@multica/core/chat", () => {
  const useChatStore = <T,>(selector: (s: typeof chatState) => T) => selector(chatState);
  useChatStore.getState = () => chatState;
  return { useChatStore };
});

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({
    chat: () => "/acme/chat",
    inbox: () => "/acme/inbox",
    agents: () => "/acme/agents",
    squads: () => "/acme/squads",
    workflows: () => "/acme/workflows",
    skills: () => "/acme/skills",
    runtimes: () => "/acme/runtimes",
    usage: () => "/acme/usage",
    settings: () => "/acme/settings",
  }),
}));

vi.mock("@multica/ui/hooks/use-mobile", () => ({
  useIsMobile: () => layout.mobile,
}));

vi.mock("./components/chat-window", () => ({
  ChatWindow: ({ variant }: { variant?: string }) => (
    <div data-testid="chat-window" data-variant={variant ?? "floating"} />
  ),
}));

const panelProps: Record<string, { minSize?: unknown }> = {};

vi.mock("@multica/ui/components/ui/resizable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@multica/ui/components/ui/resizable")>();
  return {
    ...actual,
    ResizablePanel: (props: React.ComponentProps<typeof actual.ResizablePanel>) => {
      if (props.id) panelProps[props.id] = { minSize: props.minSize };
      return <actual.ResizablePanel {...props} />;
    },
  };
});

const { DockedChatLayout } = await import("./docked-chat-layout");
const { DockedStatusBar } = await import("../layout/docked-status-bar");

function renderAt(pathname: string, enabled?: boolean, pageFirstPaths?: string[]) {
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname,
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
  return render(
    <NavigationProvider value={navigation}>
      <DockedChatLayout enabled={enabled} pageFirstPaths={pageFirstPaths}>
        <div data-testid="route-page">page</div>
      </DockedChatLayout>
      <DockedStatusBar />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  chatState.floatingChatEnabled = false;
  layout.mobile = false;
  localStorage.clear();
});

describe("DockedChatLayout", () => {
  it("puts the conversation in the middle and the page on the right when floating chat is off", () => {
    renderAt("/acme/issues");

    const chat = screen.getByTestId("chat-window");
    const page = screen.getByTestId("route-page");
    expect(chat).toHaveAttribute("data-variant", "docked");
    expect(chat.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page.closest("[data-slot='docked-page']")).not.toBeNull();
    expect(useDockedLayoutStore.getState().pageElement).toBe(page.closest("[data-slot='docked-page']"));
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("keeps Settings in the middle and moves the conversation to the right", () => {
    renderAt("/acme/settings");

    const chat = screen.getByTestId("chat-window");
    const page = screen.getByTestId("route-page");
    expect(page.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the Inbox in the middle and moves the conversation to the right", () => {
    renderAt("/acme/inbox");

    const chat = screen.getByTestId("chat-window");
    const page = screen.getByTestId("route-page");
    expect(page.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["/acme/agents", "/acme/squads/s1", "/acme/workflows", "/acme/skills", "/acme/runtimes", "/acme/usage"])(
    "keeps the management page %s in the middle",
    (path) => {
      renderAt(path);

      const chat = screen.getByTestId("chat-window");
      const page = screen.getByTestId("route-page");
      expect(page.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it("puts the conversation in the middle on work pages such as issues", () => {
    renderAt("/acme/projects");

    const chat = screen.getByTestId("chat-window");
    const page = screen.getByTestId("route-page");
    expect(chat.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts a page-first route such as the desktop browser in the middle", () => {
    renderAt("/acme/browser", undefined, ["/acme/browser"]);

    const chat = screen.getByTestId("chat-window");
    const page = screen.getByTestId("route-page");
    expect(page.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("never lets the docked conversation shrink below 360px", () => {
    renderAt("/acme/issues");

    expect(panelProps.conversation?.minSize).toBe("360px");
    expect(panelProps.page?.minSize).toBe("25%");
  });

  it("leaves the bottom spacing to the status bar under the shell", () => {
    renderAt("/acme/issues");

    expect(screen.getByTestId("chat-window").parentElement).not.toHaveClass("pb-[30px]");
  });

  it("reports itself active only while the conversation is docked", () => {
    const { unmount } = renderAt("/acme/issues");
    expect(useDockedLayoutStore.getState().layoutActive).toBe(true);
    unmount();
    expect(useDockedLayoutStore.getState().layoutActive).toBe(false);

    chatState.floatingChatEnabled = true;
    renderAt("/acme/issues");
    expect(useDockedLayoutStore.getState().layoutActive).toBe(false);
  });

  it("leaves the page alone while floating chat is on", () => {
    chatState.floatingChatEnabled = true;
    renderAt("/acme/issues");

    expect(screen.getByTestId("route-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });

  it("leaves the Chat tab alone, which already shows the conversation full-page", () => {
    renderAt("/acme/chat");

    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });

  it("keeps the docked shell and its status bar on the Chat tab while floating chat is off", () => {
    const { container, unmount } = renderAt("/acme/chat");

    expect(useDockedLayoutStore.getState().layoutActive).toBe(false);
    expect(useDockedLayoutStore.getState().shellDocked).toBe(true);
    expect(container.querySelector("[data-slot='docked-status-bar']")).not.toBeNull();
    unmount();
    expect(useDockedLayoutStore.getState().shellDocked).toBe(false);
  });

  it("drops the docked shell and its status bar while floating chat is on", () => {
    chatState.floatingChatEnabled = true;
    const { container } = renderAt("/acme/chat");

    expect(useDockedLayoutStore.getState().shellDocked).toBe(false);
    expect(container.querySelector("[data-slot='docked-status-bar']")).toBeNull();
  });

  it("drops the docked shell until the shell has a workspace", () => {
    const { container } = renderAt("/acme/issues", false);

    expect(useDockedLayoutStore.getState().shellDocked).toBe(false);
    expect(container.querySelector("[data-slot='docked-status-bar']")).toBeNull();
  });

  it("leaves small screens alone", () => {
    layout.mobile = true;
    renderAt("/acme/issues");

    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });

  it("renders only the page until the shell has a workspace", () => {
    renderAt("/acme/issues", false);

    expect(screen.getByTestId("route-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-window")).not.toBeInTheDocument();
  });
});
