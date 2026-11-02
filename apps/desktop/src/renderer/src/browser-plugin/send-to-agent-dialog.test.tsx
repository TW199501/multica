import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserAgentPayload } from "@elf-express/orca-browser/shared";
import type { StorageAdapter } from "@multica/core/types/storage";
import { createChatStore, registerChatStore, useChatStore } from "@multica/core/chat";

const P: BrowserAgentPayload = {
  kind: "grab",
  pageUrl: "https://example.com",
  pageTitle: "Example",
  text: "## Grab",
  images: [{ name: "shot.png", mimeType: "image/png", dataBase64: "AAAA" }],
};
const P2: BrowserAgentPayload = { ...P, text: "second" };

const push = vi.fn();
const workspace = vi.hoisted(() => ({ slug: "acme" as string | null }));
const issueSentinel = { target: "issue" };
const chatSentinel = { target: "chat" };
let chatOpenAtDeliver: boolean | null = null;

const deliverBrowserPayload = vi.fn(async (..._args: unknown[]) => {
  chatOpenAtDeliver = useChatStore.getState().isOpen;
  expect(push).not.toHaveBeenCalled();
  return { uploaded: 1, failed: 0 };
});
const issueCommentDraftTarget = vi.fn((_id: string) => issueSentinel);
const chatDraftTarget = vi.fn((_id: string) => chatSentinel);
const toastError = vi.fn();
const toastLoading = vi.fn(() => "toast-id");
const toastDismiss = vi.fn();
let hostCaptured: { onSendToAgent?: (p: BrowserAgentPayload) => Promise<void> } | null = null;

vi.mock("@multica/core/search-index", () => ({
  searchIssues: vi.fn(async () => ({
    issues: [{ id: "i1", identifier: "MUL-1", title: "Fix login" }],
  })),
}));
vi.mock("./send-to-agent", () => ({
  deliverBrowserPayload: (...args: unknown[]) => deliverBrowserPayload(...args),
  issueCommentDraftTarget: (id: string) => issueCommentDraftTarget(id),
  chatDraftTarget: (id: string) => chatDraftTarget(id),
}));
vi.mock("@multica/views/navigation", () => ({
  useNavigation: () => ({ push }),
}));
vi.mock("@multica/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/paths")>()),
  useWorkspaceSlug: () => workspace.slug,
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@multica/core/api", () => ({ api: { uploadFile: vi.fn() } }));
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    loading: () => toastLoading(),
    dismiss: (...a: unknown[]) => toastDismiss(...a),
  },
}));
vi.mock("@elf-express/orca-browser/renderer", () => ({
  BrowserPluginProvider: ({
    host,
    children,
  }: {
    host: typeof hostCaptured;
    children: React.ReactNode;
  }) => {
    hostCaptured = host;
    return <>{children}</>;
  },
}));

import { SendToAgentDialog } from "./send-to-agent-dialog";
import { useBrowserSendStore } from "./send-to-agent-store";
import { DesktopBrowserPluginProvider } from "./browser-renderer-host";

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SendToAgentDialog />
    </QueryClientProvider>,
  );
}

function openSend(payload: BrowserAgentPayload) {
  let sent!: Promise<void>;
  act(() => {
    sent = useBrowserSendStore.getState().open(payload);
  });
  // Observe rejections up front so an early reject is never reported as unhandled.
  const outcome = sent.then(
    () => null,
    (e: Error) => e,
  );
  return { sent, outcome };
}

// jsdom lacks the observers and scrolling cmdk relies on.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

beforeEach(() => {
  vi.clearAllMocks();
  chatOpenAtDeliver = null;
  hostCaptured = null;
  workspace.slug = "acme";
  useBrowserSendStore.setState({ pending: null });
  const chat = createChatStore({ storage: memoryStorage() });
  registerChatStore(chat);
  chat.getState().setOpen(true);
  deliverBrowserPayload.mockImplementation(async () => {
    chatOpenAtDeliver = useChatStore.getState().isOpen;
    expect(push).not.toHaveBeenCalled();
    return { uploaded: 1, failed: 0 };
  });
});

describe("SendToAgentDialog", () => {
  it("renders nothing without a pending payload", () => {
    const { container } = renderDialog();
    expect(container).toBeEmptyDOMElement();
    expect(document.body.querySelector("[data-slot='command']")).toBeNull();
  });

  it("sends to the selected issue and navigates to it", async () => {
    renderDialog();
    const { sent } = openSend(P);
    fireEvent.change(await screen.findByPlaceholderText("Search issues..."), { target: { value: "login" } });
    fireEvent.click(await screen.findByText("Fix login"));

    await expect(sent).resolves.toBeUndefined();
    expect(issueCommentDraftTarget).toHaveBeenCalledWith("i1");
    expect(deliverBrowserPayload).toHaveBeenCalledWith(
      P,
      issueSentinel,
      expect.objectContaining({ api: expect.anything() }),
    );
    expect(push).toHaveBeenCalledWith("/acme/issues/i1");
    expect(useBrowserSendStore.getState().pending).toBeNull();
  });

  it("sends to the chat input", async () => {
    renderDialog();
    const { sent } = openSend(P);
    fireEvent.click(await screen.findByText("Chat input"));
    await sent;

    expect(chatOpenAtDeliver).toBe(false);
    expect(chatDraftTarget).toHaveBeenCalledWith("__new__");
    expect(push).toHaveBeenCalledWith("/acme/chat");
  });

  it("rejects the host promise when screenshots fail", async () => {
    deliverBrowserPayload.mockResolvedValueOnce({ uploaded: 0, failed: 1 });
    renderDialog();
    const { outcome } = openSend(P);
    fireEvent.click(await screen.findByText("Chat input"));

    const error = await outcome;
    expect(error?.message).toBe("Some screenshots failed to upload");
    expect(toastError).toHaveBeenCalledWith(
      "Some screenshots failed to upload. The text was kept in the draft.",
    );
  });

  it("does not navigate when delivery throws", async () => {
    deliverBrowserPayload.mockRejectedValueOnce(new Error("draft store unavailable"));
    renderDialog();
    const { outcome } = openSend(P);
    fireEvent.click(await screen.findByText("Chat input"));

    expect((await outcome)?.message).toBe("draft store unavailable");
    expect(push).not.toHaveBeenCalled();
  });

  it("still navigates after a partial upload failure", async () => {
    deliverBrowserPayload.mockResolvedValueOnce({ uploaded: 0, failed: 1 });
    renderDialog();
    const { outcome } = openSend(P);
    fireEvent.click(await screen.findByText("Chat input"));

    expect((await outcome)?.message).toBe("Some screenshots failed to upload");
    expect(push).toHaveBeenCalledWith("/acme/chat");
  });

  it("rejects with AbortError when the dialog is dismissed", async () => {
    renderDialog();
    const { outcome } = openSend(P);
    await screen.findByPlaceholderText("Search issues...");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    expect((await outcome)?.name).toBe("AbortError");
    expect(deliverBrowserPayload).not.toHaveBeenCalled();
  });

  it("a new payload cancels the previous one", async () => {
    const { outcome } = openSend(P);
    act(() => {
      void useBrowserSendStore.getState().open(P2);
    });
    expect((await outcome)?.name).toBe("AbortError");
    expect(useBrowserSendStore.getState().pending?.payload).toBe(P2);
  });

  it("cancels a pending send when the active workspace changes", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={qc}>
        <DesktopBrowserPluginProvider>
          <SendToAgentDialog />
        </DesktopBrowserPluginProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    let sent!: Promise<void>;
    act(() => {
      sent = hostCaptured!.onSendToAgent!(P);
    });
    const outcome = sent.then(
      () => null,
      (e: Error) => e,
    );
    await screen.findByText("Chat input");

    workspace.slug = "beta";
    rerender(tree());

    expect((await outcome)?.name).toBe("AbortError");
    await waitFor(() => expect(screen.queryByText("Chat input")).toBeNull());
    expect(deliverBrowserPayload).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("host forwards payloads to the send store", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <DesktopBrowserPluginProvider>
          <div />
        </DesktopBrowserPluginProvider>
      </QueryClientProvider>,
    );
    let result!: Promise<void>;
    act(() => {
      result = hostCaptured!.onSendToAgent!(P);
    });
    expect(result).toBeInstanceOf(Promise);
    expect(useBrowserSendStore.getState().pending?.payload).toBe(P);
    act(() => useBrowserSendStore.getState().cancel());
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(useBrowserSendStore.getState().pending).toBeNull());
  });
});
