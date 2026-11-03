import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { useCommentComposerStore, useCommentDraftStore } from "@multica/core/issues/stores";
import { renderWithI18n } from "../../test/i18n";

const apiGetAISettingsStatus = vi.hoisted(() => vi.fn());
const apiPolishText = vi.hoisted(() => vi.fn());
const apiListWorkspaces = vi.hoisted(() => vi.fn());
const apiPreviewCommentTriggers = vi.hoisted(() => vi.fn());
const apiListTasksByIssue = vi.hoisted(() => vi.fn());

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
    listTasksByIssue: apiListTasksByIssue,
    cancelTask: vi.fn(),
  },
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderUi(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSlugProvider slug="acme">{ui}</WorkspaceSlugProvider>
    </QueryClientProvider>,
  );
}

interface ComposerCase {
  name: string;
  render: (send: (...args: any[]) => any) => void;
  shell?: string;
  sendLabel: string;
}

const composers: ComposerCase[] = [
  {
    name: "chat",
    sendLabel: "Send",
    render: (send) => renderUi(<ChatInput onSend={send} agentName="Multica" />),
  },
  {
    name: "comment",
    shell: "comment-composer-shell",
    sendLabel: "Send",
    render: (send) => renderUi(<CommentInput issueId="issue-1" onSubmit={send} />),
  },
  {
    name: "reply",
    shell: "reply-composer-shell",
    sendLabel: "Send",
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
  },
];

async function typeInto(composer: ComposerCase, text: string) {
  if (composer.shell) fireEvent.click(screen.getByTestId(composer.shell));
  const editor = (await screen.findByTestId("editor")) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value: text } });
  return editor;
}

/** The composer's own send button, never the dialog's. */
function composerSendButton() {
  const buttons = screen.getAllByRole("button", { name: "Send", hidden: true });
  const outside = buttons.find((button) => !button.closest("[role='dialog']"));
  if (!outside) throw new Error("composer send button not found");
  return outside;
}

async function waitForPolished(text: string) {
  const dialog = await screen.findByRole("dialog", { name: "Polish message" });
  await waitFor(() =>
    expect((within(dialog).getByLabelText("After") as HTMLTextAreaElement).value).toBe(text),
  );
  return dialog;
}

beforeEach(() => {
  apiGetAISettingsStatus.mockReset();
  apiGetAISettingsStatus.mockResolvedValue({ polish_available: true });
  apiPolishText.mockReset();
  apiPolishText.mockResolvedValue({ text: "Hello world." });
  apiListWorkspaces.mockReset();
  apiListWorkspaces.mockResolvedValue([WORKSPACE]);
  apiPreviewCommentTriggers.mockReset();
  apiPreviewCommentTriggers.mockResolvedValue({ agents: [] });
  apiListTasksByIssue.mockReset();
  apiListTasksByIssue.mockResolvedValue([]);
  localStorage.clear();
  resetComposerMocks();
  mockChatState.activeSessionId = "session-1";
  useCommentDraftStore.setState({ drafts: {} });
  useCommentComposerStore.setState({
    sticky: true,
    runningAgentReply: "steer",
    polishOnSend: true,
    executionMode: "multi",
  });
});

describe("usePolishGate", () => {
  for (const composer of composers) {
    it(`gate submits directly when off (${composer.name})`, async () => {
      useCommentComposerStore.setState({ polishOnSend: false });
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      await typeInto(composer, "hello wrld");
      await screen.findByRole("button", { name: "Polish message" });

      fireEvent.click(composerSendButton());

      await waitFor(() => expect(send).toHaveBeenCalled());
      expect(send.mock.calls[0]?.[0]).toBe("hello wrld");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(apiPolishText).not.toHaveBeenCalled();
    });

    it(`gate submits directly when polish is unavailable (${composer.name})`, async () => {
      apiGetAISettingsStatus.mockResolvedValue({ polish_available: false });
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      await typeInto(composer, "hello wrld");
      await waitFor(() => expect(apiGetAISettingsStatus).toHaveBeenCalled());

      fireEvent.click(composerSendButton());

      await waitFor(() => expect(send).toHaveBeenCalled());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it(`gate opens the dialog instead of sending when on (${composer.name})`, async () => {
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      await typeInto(composer, "hello wrld");
      await screen.findByRole("button", { name: "Polish message" });

      fireEvent.click(composerSendButton());

      const dialog = await waitForPolished("Hello world.");
      expect(within(dialog).getByRole("button", { name: "Send" })).toBeInTheDocument();
      expect(within(dialog).getByText(/turn off message polish/)).toBeInTheDocument();
      expect(apiPolishText.mock.calls[0]?.[1]).toBe("hello wrld");
      expect(send).not.toHaveBeenCalled();
    });

    it(`enter key is gated too (${composer.name})`, async () => {
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      const editor = await typeInto(composer, "hello wrld");
      await screen.findByRole("button", { name: "Polish message" });

      fireEvent.keyDown(editor, { key: "Enter" });

      await waitForPolished("Hello world.");
      expect(send).not.toHaveBeenCalled();
    });

    it(`closing the dialog sends nothing (${composer.name})`, async () => {
      const send = vi.fn().mockResolvedValue("comment-1");
      composer.render(send);
      const editor = await typeInto(composer, "hello wrld");
      await screen.findByRole("button", { name: "Polish message" });
      fireEvent.click(composerSendButton());
      const dialog = await waitForPolished("Hello world.");

      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(send).not.toHaveBeenCalled();
      expect(editor.value).toBe("hello wrld");
    });
  }

  it("send from the dialog submits the edited text with the recipient choices", async () => {
    apiPreviewCommentTriggers.mockResolvedValue({
      agents: [{ id: "agent-1", name: "Lambda", source: "mention_agent", reason: "" }],
    });
    const send = vi.fn().mockResolvedValue("comment-9");
    renderUi(<CommentInput issueId="issue-1" onSubmit={send} />);
    await typeInto(composers[1]!, "hello wrld");

    // Mark the only recipient as "Won't start this time".
    await waitFor(() => {
      const chip = screen.getByRole("button", { name: "Lambda trigger: Will start when sent" });
      if (chip.getAttribute("aria-expanded") !== "true") fireEvent.click(chip);
      expect(screen.getByRole("menuitemradio", { name: /Won't start this time/ })).toBeInTheDocument();
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Won't start this time/ }));
    await screen.findByRole("button", { name: "Lambda trigger: Won't start this time" });

    fireEvent.click(composerSendButton());
    const dialog = await waitForPolished("Hello world.");
    fireEvent.change(within(dialog).getByLabelText("After"), { target: { value: "Hello, world!" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Hello, world!", undefined, ["agent-1"], undefined),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe("");
    expect(useCommentDraftStore.getState().getDraft("new:issue-1")).toBeUndefined();
  }, 15_000);

  it("send from the dialog keeps steering a running turn", async () => {
    const turn = {
      id: "turn-1", agent_id: "agent-1", issue_id: "issue-1", status: "running", priority: 0,
      created_at: "2026-09-23T00:00:00Z", dispatched_at: null, started_at: "2026-09-23T00:00:01Z",
      completed_at: null, result: null, error: null,
      supplement_capability: "task-supplement-v1", can_supplement: true,
    };
    apiListTasksByIssue.mockResolvedValue([turn]);
    apiPreviewCommentTriggers.mockResolvedValue({
      agents: [{ id: "agent-1", name: "Lambda", source: "thread_parent", reason: "" }],
    });
    const send = vi.fn().mockResolvedValue("reply-9");
    renderUi(
      <ReplyInput issueId="issue-1" parentId="comment-1" avatarType="member" avatarId="user-1"
        onSubmit={send} steerByDefault={(task) => task.id === "turn-1"} />,
    );
    await typeInto(composers[2]!, "only fix web");
    await screen.findByRole("button", { name: "Lambda trigger: Add to current run" }, { timeout: 5000 });

    fireEvent.click(composerSendButton());
    const dialog = await waitForPolished("Hello world.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Hello world.", undefined, undefined, ["turn-1"]),
    );
  }, 15_000);

  it("chat sends the text from the dialog and syncs the draft first", async () => {
    const send = vi.fn().mockResolvedValue(true);
    renderUi(<ChatInput onSend={send} agentName="Multica" />);
    await typeInto(composers[0]!, "hello wrld");
    await screen.findByRole("button", { name: "Polish message" });

    fireEvent.click(composerSendButton());
    const dialog = await waitForPolished("Hello world.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]?.[0]).toBe("Hello world.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("disables the close button while the send is in flight", async () => {
    const pending = deferred<string>();
    const send = vi.fn().mockReturnValue(pending.promise);
    renderUi(<CommentInput issueId="issue-1" onSubmit={send} />);
    await typeInto(composers[1]!, "hello wrld");
    await screen.findByRole("button", { name: "Polish message" });

    fireEvent.click(composerSendButton());
    const dialog = await waitForPolished("Hello world.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    pending.resolve("comment-9");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
