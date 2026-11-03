import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { useCommentComposerStore, useCommentDraftStore } from "@multica/core/issues/stores";
import { renderWithI18n } from "../../test/i18n";
import { appendDecision, splitDecision } from "./decision";

const apiGetAISettingsStatus = vi.hoisted(() => vi.fn());
const apiPolishText = vi.hoisted(() => vi.fn());
const apiListWorkspaces = vi.hoisted(() => vi.fn());
const apiPreviewCommentTriggers = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@multica/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/api")>()),
  api: {
    getBaseUrl: () => "https://api.example.test",
    getAISettingsStatus: apiGetAISettingsStatus,
    polishText: apiPolishText,
    listWorkspaces: apiListWorkspaces,
    uploadFile: vi.fn(),
    listQuickActions: vi.fn().mockResolvedValue({ quick_actions: [] }),
    renderQuickAction: vi.fn(),
    previewCommentTriggers: apiPreviewCommentTriggers,
    listTasksByIssue: vi.fn().mockResolvedValue([]),
    cancelTask: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => <span data-testid="actor-avatar" />,
  AgentStatusDot: () => null,
}));

vi.mock("@multica/core/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@multica/core/agents")>()),
  useAgentPresenceDetail: () => "loading",
}));

vi.mock("../../projects/components/project-picker", () => ({
  ProjectPicker: () => null,
}));

vi.mock("..", async () => (await import("../../test/composer-mocks")).editorModule());
vi.mock("@multica/core/chat", async () => (await import("../../test/composer-mocks")).chatModule());

import { mockChatState, resetComposerMocks } from "../../test/composer-mocks";
import { ChatInput } from "../../chat/components/chat-input";
import { CommentInput } from "../../issues/components/comment-input";
import { ReplyInput } from "../../issues/components/reply-input";

const WORKSPACE = { id: "ws-1", slug: "acme", name: "Acme" };
const APPROVE_MULTI = "決議：核准執行\nUse superpowers:subagent-driven-development";
const APPROVE_SINGLE = "決議：核准執行\nUse superpowers:executing-plans";
const DISCUSS = "決議：再議討論\nDo not start. Wait for further discussion.";

function renderUi(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSlugProvider slug="acme">{ui}</WorkspaceSlugProvider>
    </QueryClientProvider>,
    { locale: "zh-Hant" },
  );
}

interface ComposerCase {
  name: string;
  shell?: string;
  render: (send: (...args: any[]) => any) => void;
}

const chat: ComposerCase = {
  name: "chat",
  render: (send) => renderUi(<ChatInput onSend={send} agentName="Multica" />),
};
const comment: ComposerCase = {
  name: "comment",
  shell: "comment-composer-shell",
  render: (send) => renderUi(<CommentInput issueId="issue-1" onSubmit={send} />),
};
const reply: ComposerCase = {
  name: "reply",
  shell: "reply-composer-shell",
  render: (send) =>
    renderUi(
      <ReplyInput
        issueId="issue-1"
        parentId="comment-1"
        avatarType="member"
        avatarId="user-1"
        draftKey="reply:issue-1:comment-1"
        onSubmit={send}
      />,
    ),
};
const composers = [chat, comment, reply];

async function typeInto(composer: ComposerCase, text: string) {
  if (composer.shell) fireEvent.click(screen.getByTestId(composer.shell));
  const editor = (await screen.findByTestId("editor")) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: text } });
  return editor;
}

function composerSendButton() {
  const buttons = screen.getAllByRole("button", { name: "傳送", hidden: true });
  const outside = buttons.find((button) => !button.closest("[role='dialog']"));
  if (!outside) throw new Error("composer send button not found");
  return outside;
}

async function choose(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: select }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  apiGetAISettingsStatus.mockReset();
  apiGetAISettingsStatus.mockResolvedValue({ polish_available: true });
  apiPolishText.mockReset();
  apiPolishText.mockResolvedValue({ text: "Hello world." });
  apiListWorkspaces.mockReset();
  apiListWorkspaces.mockResolvedValue([WORKSPACE]);
  toastSuccess.mockReset();
  apiPreviewCommentTriggers.mockReset();
  apiPreviewCommentTriggers.mockResolvedValue({ agents: [] });
  localStorage.clear();
  resetComposerMocks();
  mockChatState.activeSessionId = "session-1";
  useCommentDraftStore.setState({ drafts: {} });
  useCommentComposerStore.setState({
    sticky: true,
    runningAgentReply: "steer",
    polishOnSend: false,
    executionMode: "multi",
  });
});

describe("appendDecision", () => {
  it("appendDecision adds the exact lines", () => {
    expect(appendDecision("ship it", "approve", "multi")).toBe(`ship it\n\n${APPROVE_MULTI}`);
    expect(appendDecision("ship it", "approve", "single")).toBe(`ship it\n\n${APPROVE_SINGLE}`);
    expect(appendDecision("not yet", "discuss", "multi")).toBe(`not yet\n\n${DISCUSS}`);
    expect(appendDecision("not yet", "discuss", "single")).toBe(`not yet\n\n${DISCUSS}`);
    expect(appendDecision("as is", null, "multi")).toBe("as is");
    expect(appendDecision("", "approve", "multi")).toBe(APPROVE_MULTI);
    expect(appendDecision("  ", "discuss", "single")).toBe(DISCUSS);
    // An existing trailing block is replaced, never doubled.
    expect(appendDecision(`ship it\n\n${APPROVE_SINGLE}`, "approve", "multi")).toBe(`ship it\n\n${APPROVE_MULTI}`);
    expect(appendDecision(DISCUSS, "approve", "multi")).toBe(APPROVE_MULTI);
    for (const decision of ["approve", "discuss"] as const) {
      for (const mode of ["single", "multi"] as const) {
        expect(appendDecision("x", decision, mode)).not.toMatch(/[「」（）()]/);
      }
    }
  });
});

describe("splitDecision", () => {
  it("separates each exact trailing block and leaves other text alone", () => {
    expect(splitDecision(`hello\n\n${APPROVE_MULTI}`)).toEqual({ text: "hello", decision: "approve", mode: "multi" });
    expect(splitDecision(`hello\n\n${APPROVE_SINGLE}\n`)).toEqual({ text: "hello", decision: "approve", mode: "single" });
    expect(splitDecision(DISCUSS)).toEqual({ text: "", decision: "discuss", mode: null });
    expect(splitDecision(`hello ${APPROVE_MULTI}`)).toEqual({ text: `hello ${APPROVE_MULTI}`, decision: null, mode: null });
    expect(splitDecision("plain")).toEqual({ text: "plain", decision: null, mode: null });
  });
});

describe("DecisionBar in composers", () => {
  for (const composer of composers) {
    it(`selecting a decision does not send (${composer.name})`, async () => {
      const user = userEvent.setup();
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      await typeInto(composer, "hello");

      await choose(user, "決議", "核准執行");

      expect(screen.getByRole("combobox", { name: "決議" })).toHaveTextContent("核准執行");
      expect(send).not.toHaveBeenCalled();
    });

    it(`send appends the decision (${composer.name})`, async () => {
      const user = userEvent.setup();
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      await typeInto(composer, "hello");
      await choose(user, "決議", "核准執行");

      fireEvent.click(composerSendButton());

      await waitFor(() => expect(send).toHaveBeenCalled());
      expect(send.mock.calls[0]?.[0]).toBe(`hello\n\n${APPROVE_MULTI}`);
    });

    it(`empty text with a decision can be sent (${composer.name})`, async () => {
      const user = userEvent.setup();
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      if (composer.shell) fireEvent.click(screen.getByTestId(composer.shell));
      await screen.findByTestId("editor");
      expect(composerSendButton()).toBeDisabled();

      await choose(user, "決議", "再議討論");
      expect(composerSendButton()).toBeEnabled();
      fireEvent.click(composerSendButton());

      await waitFor(() => expect(send).toHaveBeenCalled());
      expect(send.mock.calls[0]?.[0]).toBe(DISCUSS);
    });

    it(`decision shows the muted placeholder and resets after sending (${composer.name})`, async () => {
      const user = userEvent.setup();
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      const trigger = screen.getByRole("combobox", { name: "決議" });
      expect(trigger).toHaveTextContent("請決定");
      expect(within(trigger).getByText("請決定")).toHaveClass("text-muted-foreground");

      await typeInto(composer, "hello");
      await choose(user, "決議", "核准執行");
      expect(within(trigger).getByText("核准執行")).not.toHaveClass("text-muted-foreground");
      fireEvent.click(composerSendButton());

      await waitFor(() => expect(send).toHaveBeenCalled());
      await waitFor(() => expect(trigger).toHaveTextContent("請決定"));
      expect(screen.queryByRole("combobox", { name: "執行" })).not.toBeInTheDocument();
    });
  }

  it("send from the polish dialog appends the decision after the polished text", async () => {
    useCommentComposerStore.setState({ polishOnSend: true });
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-1");
    comment.render(send);
    await typeInto(comment, "hello wrld");
    await choose(user, "決議", "核准執行");
    await screen.findByRole("button", { name: "對話優化" });

    fireEvent.click(composerSendButton());
    const dialog = await screen.findByRole("dialog", { name: "對話優化" });
    await waitFor(() =>
      expect((within(dialog).getByLabelText("優化後") as HTMLTextAreaElement).value).toBe("Hello world."),
    );
    expect(apiPolishText).toHaveBeenCalledWith("ws-1", "hello wrld", { kind: "issue", issue_id: "issue-1" });
    expect((within(dialog).getByLabelText("優化前") as HTMLTextAreaElement).value).toBe("hello wrld");
    fireEvent.click(within(dialog).getByRole("button", { name: "送出" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe(`Hello world.\n\n${APPROVE_MULTI}`);
  });

  it("execution mode shows only for approve, defaults to multi and is remembered", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-1");
    comment.render(send);
    expect(screen.queryByRole("combobox", { name: "執行" })).not.toBeInTheDocument();

    await typeInto(comment, "go");
    await choose(user, "決議", "核准執行");
    const execution = screen.getByRole("combobox", { name: "執行" });
    expect(execution).toHaveTextContent("多代理執行");
    expect(execution).toHaveClass("text-muted-foreground");

    await choose(user, "執行", "單代理執行");
    expect(useCommentComposerStore.getState().executionMode).toBe("single");
    expect(JSON.parse(localStorage.getItem("multica_comment_composer")!).state.executionMode).toBe("single");

    await choose(user, "決議", "再議討論");
    expect(screen.queryByRole("combobox", { name: "執行" })).not.toBeInTheDocument();
    await choose(user, "決議", "核准執行");

    fireEvent.click(composerSendButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe(`go\n\n${APPROVE_SINGLE}`);
    expect(screen.queryByRole("combobox", { name: "執行" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("editor"), { target: { value: "again" } });
    await choose(user, "決議", "核准執行");
    expect(screen.getByRole("combobox", { name: "執行" })).toHaveTextContent("單代理執行");
  });

  it("decision toasts with a view action", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-42");
    const onAccepted = vi.fn();
    renderUi(<CommentInput issueId="issue-1" onSubmit={send} onAccepted={onAccepted} />);

    // No decision, no toast.
    await typeInto(comment, "plain");
    fireEvent.click(composerSendButton());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[0]).toBe("plain");
    expect(toastSuccess).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("editor"), { target: { value: "ship" } });
    await choose(user, "決議", "核准執行");
    fireEvent.click(composerSendButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [message, options] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("已送出決議：核准執行");
    expect(options.action.label).toBe("查看");
    // The view action lands through the host's own posted-comment jump.
    onAccepted.mockClear();
    options.action.onClick();
    expect(onAccepted).toHaveBeenCalledWith("comment-42");
  });

  it("reply decision toast lands through the host's jump", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("reply-7");
    const onAccepted = vi.fn();
    renderUi(
      <ReplyInput issueId="issue-1" parentId="comment-1" avatarType="member" avatarId="user-1"
        draftKey="reply:issue-1:comment-1" onSubmit={send} onAccepted={onAccepted} />,
    );
    await typeInto(reply, "ok");
    await choose(user, "決議", "再議討論");
    fireEvent.click(composerSendButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [, options] = toastSuccess.mock.calls[0] as [string, { action: { onClick: () => void } }];
    onAccepted.mockClear();
    options.action.onClick();
    expect(onAccepted).toHaveBeenCalledWith("reply-7");
  });

  it("chat decision toast asks its message list to show the latest message", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue(true);
    const { container } = renderUi(
      <div>
        <div data-tab-scroll-root data-testid="other-list" />
        <div data-chat-message-list="" data-testid="message-list" />
        <ChatInput onSend={send} agentName="Multica" />
      </div>,
    );
    const onScrollRequest = vi.fn();
    within(container).getByTestId("message-list")
      .addEventListener("multica:chat-scroll-to-latest", onScrollRequest);
    const other = within(container).getByTestId("other-list");
    other.scrollTo = vi.fn() as typeof other.scrollTo;

    await typeInto(chat, "done");
    await choose(user, "決議", "再議討論");
    fireEvent.click(composerSendButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [message, options] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("已送出決議：再議討論");
    options.action.onClick();
    expect(onScrollRequest).toHaveBeenCalledTimes(1);
    expect(other.scrollTo).not.toHaveBeenCalled();
  });

  it("choosing the placeholder clears the decision", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-1");
    comment.render(send);
    await typeInto(comment, "hello");
    await choose(user, "決議", "核准執行");

    await choose(user, "決議", "請決定");
    const trigger = screen.getByRole("combobox", { name: "決議" });
    expect(within(trigger).getByText("請決定")).toHaveClass("text-muted-foreground");
    fireEvent.click(composerSendButton());

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe("hello");
  });

  it("decision-only comment previews and routes its recipients", async () => {
    apiPreviewCommentTriggers.mockResolvedValue({
      agents: [{ id: "agent-1", name: "Lambda", source: "issue_assignee", reason: "" }],
    });
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-1");
    comment.render(send);
    fireEvent.click(screen.getByTestId("comment-composer-shell"));
    await screen.findByTestId("editor");
    await choose(user, "決議", "核准執行");

    await waitFor(() => expect(apiPreviewCommentTriggers).toHaveBeenCalled());
    expect(JSON.stringify(apiPreviewCommentTriggers.mock.calls.at(-1))).toContain("決議：核准執行");
    await waitFor(() => {
      const chip = screen.getByRole("button", { name: /^Lambda/ });
      if (chip.getAttribute("aria-expanded") !== "true") fireEvent.click(chip);
      expect(screen.getByRole("menuitemradio", { name: /本次不會開始/ })).toBeInTheDocument();
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: /本次不會開始/ }));
    await screen.findByRole("button", { name: /^Lambda.*本次不會開始/ });
    fireEvent.click(composerSendButton());

    await waitFor(() => expect(send).toHaveBeenCalledWith(APPROVE_MULTI, undefined, ["agent-1"], undefined));
  }, 15_000);
});

describe("chat decisions across restores and sessions", () => {
  type ChatProps = Partial<React.ComponentProps<typeof ChatInput>>;
  function renderChat(props: ChatProps = {}) {
    const send = vi.fn().mockResolvedValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (extra: ChatProps) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceSlugProvider slug="acme">
          <ChatInput onSend={send} agentName="Multica" {...props} {...extra} />
        </WorkspaceSlugProvider>
      </QueryClientProvider>
    );
    const view = renderWithI18n(tree({}), { locale: "zh-Hant" });
    return { send, rerender: (extra: ChatProps) => view.rerender(tree(extra)) };
  }

  function editorValue() {
    return (screen.getByTestId("editor") as HTMLTextAreaElement).value;
  }

  it("restore after a failed send keeps the block out of the text and re-selects the decision", async () => {
    const { send } = renderChat({
      restoreDraftRequest: { id: "restore-1", content: `hello\n\n${APPROVE_SINGLE}`, sessionId: "session-1" },
    });

    await waitFor(() => expect(editorValue()).toBe("hello"));
    expect(screen.getByRole("combobox", { name: "決議" })).toHaveTextContent("核准執行");
    expect(screen.getByRole("combobox", { name: "執行" })).toHaveTextContent("單代理執行");
    expect(mockChatState.inputDrafts["session-1"]).toBe("hello");

    fireEvent.click(composerSendButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe(`hello\n\n${APPROVE_SINGLE}`);
  });

  it("restored text with polish on never sends a decision line to the polish API", async () => {
    useCommentComposerStore.setState({ polishOnSend: true });
    const { send } = renderChat({
      restoreDraftRequest: { id: "restore-2", content: `hello wrld\n\n${DISCUSS}`, sessionId: "session-1" },
    });
    await waitFor(() => expect(editorValue()).toBe("hello wrld"));
    await screen.findByRole("button", { name: "對話優化" });

    fireEvent.click(composerSendButton());
    const dialog = await screen.findByRole("dialog", { name: "對話優化" });
    await waitFor(() =>
      expect((within(dialog).getByLabelText("優化後") as HTMLTextAreaElement).value).toBe("Hello world."),
    );
    expect(apiPolishText).toHaveBeenCalled();
    for (const call of apiPolishText.mock.calls) expect(String(call[1])).not.toContain("決議");
    fireEvent.click(within(dialog).getByRole("button", { name: "送出" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe(`Hello world.\n\n${DISCUSS}`);
  });

  it("sending twice never yields two decision blocks", async () => {
    const user = userEvent.setup();
    const { send } = renderChat({
      restoreDraftRequest: { id: "restore-3", content: `again\n\n${APPROVE_MULTI}`, sessionId: "session-1" },
    });
    await waitFor(() => expect(editorValue()).toBe("again"));
    // Re-picking a different decision replaces, never stacks.
    await choose(user, "決議", "再議討論");
    fireEvent.click(composerSendButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    const sent = send.mock.calls[0]?.[0] as string;
    expect(sent).toBe(`again\n\n${DISCUSS}`);
    expect(sent.match(/決議：/g)).toHaveLength(1);
  });

  it("a decision picked in one session does not go out in another", async () => {
    const user = userEvent.setup();
    const { send, rerender } = renderChat();
    await choose(user, "決議", "核准執行");

    mockChatState.activeSessionId = "session-2";
    rerender({});
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "決議" })).toHaveTextContent("請決定"),
    );
    fireEvent.change(screen.getByTestId("editor"), { target: { value: "for session two" } });
    fireEvent.click(composerSendButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe("for session two");

    mockChatState.activeSessionId = "session-1";
    rerender({});
    expect(screen.getByRole("combobox", { name: "決議" })).toHaveTextContent("請決定");
  });

  it("a conversation starter goes out without the chosen decision", async () => {
    const user = userEvent.setup();
    const { send, rerender } = renderChat();
    await choose(user, "決議", "核准執行");

    rerender({ conversationStarterRequest: { id: 1, content: "Summarize this" } });

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe("Summarize this");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "決議" })).toHaveTextContent("核准執行");
  });
});
