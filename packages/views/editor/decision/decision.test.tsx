import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { useCommentComposerStore, useCommentDraftStore } from "@multica/core/issues/stores";
import { renderWithI18n } from "../../test/i18n";
import { appendDecision } from "./decision";

const apiGetAISettingsStatus = vi.hoisted(() => vi.fn());
const apiPolishText = vi.hoisted(() => vi.fn());
const apiListWorkspaces = vi.hoisted(() => vi.fn());
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
    previewCommentTriggers: vi.fn().mockResolvedValue({ agents: [] }),
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
    for (const decision of ["approve", "discuss"] as const) {
      for (const mode of ["single", "multi"] as const) {
        expect(appendDecision("x", decision, mode)).not.toMatch(/[「」（）()]/);
      }
    }
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
      expect(screen.getByRole("combobox", { name: "執行" })).toHaveTextContent("多代理執行");
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

  it("execution mode defaults to multi and is remembered", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-1");
    comment.render(send);
    expect(screen.getByRole("combobox", { name: "執行" })).toHaveTextContent("多代理執行");

    await choose(user, "執行", "單代理執行");
    expect(useCommentComposerStore.getState().executionMode).toBe("single");
    expect(JSON.parse(localStorage.getItem("multica_comment_composer")!).state.executionMode).toBe("single");

    await typeInto(comment, "go");
    await choose(user, "決議", "核准執行");
    fireEvent.click(composerSendButton());
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe(`go\n\n${APPROVE_SINGLE}`);
    expect(screen.getByRole("combobox", { name: "執行" })).toHaveTextContent("單代理執行");
  });

  it("decision toasts with a view action", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue("comment-42");
    comment.render(send);
    const anchor = document.createElement("div");
    anchor.id = "comment-comment-42";
    anchor.scrollIntoView = vi.fn();
    document.body.appendChild(anchor);

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
    options.action.onClick();
    expect(anchor.scrollIntoView).toHaveBeenCalled();
    anchor.remove();
  });

  it("chat decision toast scrolls the message list to the latest message", async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue(true);
    const { container } = renderUi(
      <div>
        <div data-tab-scroll-root data-testid="message-list" />
        <ChatInput onSend={send} agentName="Multica" />
      </div>,
    );
    const list = within(container).getByTestId("message-list");
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 900 });
    list.scrollTo = vi.fn() as typeof list.scrollTo;

    await typeInto(chat, "done");
    await choose(user, "決議", "再議討論");
    fireEvent.click(composerSendButton());

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const [message, options] = toastSuccess.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("已送出決議：再議討論");
    options.action.onClick();
    expect(list.scrollTo).toHaveBeenCalledWith({ top: 900 });
  });
});
