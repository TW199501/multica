import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@multica/core/api";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { useCommentDraftStore } from "@multica/core/issues/stores";
import type { SupportedLocale } from "@multica/core/i18n";
import type { PolishContext } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import type { ContentEditorRef } from "../content-editor";

const apiGetAISettingsStatus = vi.hoisted(() => vi.fn());
const apiPolishText = vi.hoisted(() => vi.fn());
const apiListWorkspaces = vi.hoisted(() => vi.fn());
// Drives the mock editor's upload state the way a real paste would: the
// document reports an uploading node and tells the host through
// onUploadingChange.
const editorUpload = vi.hoisted(() => ({
  active: false,
  notify: undefined as ((uploading: boolean) => void) | undefined,
}));

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
    previewCommentTriggers: vi.fn(),
    listTasksByIssue: vi.fn(),
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

// The composers keep their own drafts; this mock mirrors the real handle's
// contract that matters here: `adoptContent` replaces the document WITHOUT
// firing onUpdate, so a composer that forgets to sync its draft is caught.
vi.mock("..", async () => ({
  ...(await vi.importActual<typeof import("../use-lazy-editor")>("../use-lazy-editor")),
  ...(await vi.importActual<typeof import("../use-upload-gate")>("../use-upload-gate")),
  ...(await vi.importActual<typeof import("../use-composer-submit")>("../use-composer-submit")),
  useEditorUpload: () => ({ uploadWithToast: vi.fn(), upload: vi.fn(), uploading: false }),
  useFileDropZone: () => ({ isDragOver: false, dropZoneProps: {} }),
  FileDropOverlay: () => null,
  ContentEditor: forwardRef(function MockContentEditor(
    {
      defaultValue,
      value,
      onUpdate,
      onReady,
      onUploadingChange,
      placeholder,
    }: {
      defaultValue?: string;
      value?: string;
      onUpdate?: (markdown: string) => void;
      onReady?: () => void;
      onUploadingChange?: (uploading: boolean) => void;
      placeholder?: string;
    },
    ref: Ref<unknown>,
  ) {
    editorUpload.notify = onUploadingChange;
    const initial = value ?? defaultValue ?? "";
    const valueRef = useRef(initial);
    const [text, setText] = useState(initial);
    useEffect(() => {
      onReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
      if (value === undefined || value === valueRef.current) return;
      valueRef.current = value;
      setText(value);
    }, [value]);
    useImperativeHandle(ref, () => ({
      getMarkdown: () => valueRef.current,
      clearContent: () => {
        valueRef.current = "";
        setText("");
      },
      adoptContent: (markdown: string) => {
        valueRef.current = markdown;
        setText(markdown);
      },
      flushPendingUpdate: () => null,
      focus: () => {},
      focusAtCoords: () => {},
      blur: () => {},
      uploadFile: () => {},
      hasActiveUploads: () => editorUpload.active,
      insertUploadPlaceholder: () => true,
      settleUploadPlaceholder: () => false,
      insertMarkdownAtEnd: () => true,
    }));
    return (
      <textarea
        data-testid="editor"
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          valueRef.current = event.target.value;
          setText(event.target.value);
          onUpdate?.(event.target.value);
        }}
      />
    );
  }),
}));

vi.mock("@multica/core/chat", () => {
  const state = {
    activeSessionId: null as string | null,
    selectedAgentId: "agent-1",
    inputDrafts: {} as Record<string, string>,
    inputDraftAttachments: {} as Record<string, unknown[]>,
    setInputDraft: (key: string, value: string) => {
      state.inputDrafts[key] = value;
    },
    appendToInputDraft: vi.fn(),
    setInputDraftAttachments: vi.fn(),
    addInputDraftUpload: vi.fn(),
    settleInputDraftUpload: vi.fn(),
    failInputDraftUpload: vi.fn(),
    removeInputDraftUpload: vi.fn(),
    clearInputDraft: (key: string) => {
      delete state.inputDrafts[key];
    },
  };
  return {
    DRAFT_NEW_SESSION: "__draft_new__",
    useChatStore: Object.assign(
      (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
      { getState: () => state },
    ),
  };
});

import { useChatStore } from "@multica/core/chat";
import { ChatInput } from "../../chat/components/chat-input";
import { CommentInput } from "../../issues/components/comment-input";
import { ReplyInput } from "../../issues/components/reply-input";
import { PolishButton } from "./polish-button";
import { PolishDialog } from "./polish-dialog";

const WORKSPACE = { id: "ws-1", slug: "acme", name: "Acme" };
const ISSUE_CONTEXT: PolishContext = { kind: "issue", issue_id: "issue-1" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderUi(ui: ReactNode, locale: SupportedLocale = "en") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <WorkspaceSlugProvider slug="acme">{ui}</WorkspaceSlugProvider>
    </QueryClientProvider>,
    { locale },
  );
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof PolishDialog>> = {},
  locale: SupportedLocale = "en",
) {
  const onClose = props.onClose ?? vi.fn();
  const onConfirm = props.onConfirm ?? vi.fn();
  const view = renderUi(
    <PolishDialog
      open
      mode="adopt"
      wsId="ws-1"
      original="hello wrld"
      context={ISSUE_CONTEXT}
      {...props}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
    locale,
  );
  return { ...view, onClose, onConfirm };
}

function fakeEditorRef(markdown: string) {
  const handle = {
    getMarkdown: vi.fn(() => markdown),
    adoptContent: vi.fn(),
    hasActiveUploads: vi.fn(() => false),
  };
  return {
    handle,
    ref: { current: handle } as unknown as RefObject<ContentEditorRef | null>,
  };
}

function afterTextarea() {
  return screen.getByLabelText("After") as HTMLTextAreaElement;
}

beforeEach(() => {
  apiGetAISettingsStatus.mockReset();
  apiGetAISettingsStatus.mockResolvedValue({ polish_available: true });
  apiPolishText.mockReset();
  apiPolishText.mockResolvedValue({ text: "Hello world." });
  apiListWorkspaces.mockReset();
  apiListWorkspaces.mockResolvedValue([WORKSPACE]);
  editorUpload.active = false;
  editorUpload.notify = undefined;
  localStorage.clear();
  useCommentDraftStore.setState({ drafts: {} });
  const chat = useChatStore.getState() as unknown as {
    activeSessionId: string | null;
    inputDrafts: Record<string, string>;
  };
  chat.activeSessionId = null;
  chat.inputDrafts = {};
});

describe("PolishButton", () => {
  it("renders nothing when polish is unavailable", async () => {
    apiGetAISettingsStatus.mockResolvedValue({ polish_available: false });
    const { ref } = fakeEditorRef("hello");
    renderUi(<PolishButton wsId="ws-1" editorRef={ref} context={ISSUE_CONTEXT} />);

    await waitFor(() => expect(apiGetAISettingsStatus).toHaveBeenCalledWith("ws-1"));
    expect(screen.queryByRole("button", { name: "Polish message" })).not.toBeInTheDocument();
  });

  it("is disabled for an empty editor", async () => {
    renderUi(<CommentInput issueId="issue-1" onSubmit={vi.fn().mockResolvedValue(true)} />);
    fireEvent.click(screen.getByTestId("comment-composer-shell"));

    const button = await screen.findByRole("button", { name: "Polish message" });
    expect(button).toBeDisabled();

    fireEvent.change(await screen.findByTestId("editor"), { target: { value: "hello" } });
    expect(button).toBeEnabled();
  });

  it("comment adopts the polished text into its draft", async () => {
    renderUi(<CommentInput issueId="issue-1" onSubmit={vi.fn().mockResolvedValue(true)} />);
    fireEvent.click(screen.getByTestId("comment-composer-shell"));
    fireEvent.change(await screen.findByTestId("editor"), { target: { value: "hello wrld" } });

    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));
    expect(apiPolishText).toHaveBeenCalledWith("ws-1", "hello wrld", ISSUE_CONTEXT);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((screen.getByTestId("editor") as HTMLTextAreaElement).value).toBe("Hello world.");
    expect(useCommentDraftStore.getState().getDraft("new:issue-1")).toBe("Hello world.");
  });

  it("chat sends the adopted text", async () => {
    const chat = useChatStore.getState() as unknown as { activeSessionId: string | null; inputDrafts: Record<string, string> };
    chat.activeSessionId = "session-1";
    const onSend = vi.fn().mockResolvedValue(true);
    renderUi(<ChatInput onSend={onSend} agentName="Multica" />);
    fireEvent.change(screen.getByTestId("editor"), { target: { value: "hello wrld" } });

    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));
    expect(apiPolishText).toHaveBeenCalledWith("ws-1", "hello wrld", {
      kind: "chat",
      chat_session_id: "session-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // A refresh restores the draft store, so it must hold the adopted text too.
    expect(chat.inputDrafts["session-1"]).toBe("Hello world.");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[0]).toBe("Hello world.");
  });

  it("chat without a created session polishes without context", async () => {
    renderUi(<ChatInput onSend={vi.fn()} agentName="Multica" />);
    fireEvent.change(screen.getByTestId("editor"), { target: { value: "hello" } });

    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() =>
      expect(apiPolishText).toHaveBeenCalledWith("ws-1", "hello", { kind: "none" }),
    );
  });

  it("reply passes the thread id", async () => {
    renderUi(
      <ReplyInput
        issueId="issue-1"
        parentId="comment-1"
        avatarType="member"
        avatarId="user-1"
        draftKey="reply:issue-1:comment-1"
        onSubmit={vi.fn().mockResolvedValue("reply-1")}
      />,
    );
    fireEvent.click(screen.getByTestId("reply-composer-shell"));
    fireEvent.change(await screen.findByTestId("editor"), { target: { value: "hello wrld" } });

    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() =>
      expect(apiPolishText).toHaveBeenCalledWith("ws-1", "hello wrld", {
        kind: "issue",
        issue_id: "issue-1",
        thread_comment_id: "comment-1",
      }),
    );
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() =>
      expect(useCommentDraftStore.getState().getDraft("reply:issue-1:comment-1")).toBe("Hello world."),
    );
  });

  const composers = [
    {
      name: "chat",
      render: () => renderUi(<ChatInput onSend={vi.fn()} agentName="Multica" />),
    },
    {
      name: "comment",
      shell: "comment-composer-shell",
      render: () => renderUi(<CommentInput issueId="issue-1" onSubmit={vi.fn().mockResolvedValue(true)} />),
    },
    {
      name: "reply",
      shell: "reply-composer-shell",
      render: () =>
        renderUi(
          <ReplyInput
            issueId="issue-1"
            parentId="comment-1"
            avatarType="member"
            avatarId="user-1"
            draftKey="reply:issue-1:comment-1"
            onSubmit={vi.fn().mockResolvedValue("reply-1")}
          />,
        ),
    },
  ];
  for (const composer of composers) {
    it(`${composer.name} disables polish while an upload is in flight`, async () => {
      composer.render();
      if (composer.shell) fireEvent.click(screen.getByTestId(composer.shell));
      fireEvent.change(await screen.findByTestId("editor"), { target: { value: "hello" } });
      const button = await screen.findByRole("button", { name: "Polish message" });
      expect(button).toBeEnabled();

      act(() => {
        editorUpload.active = true;
        editorUpload.notify?.(true);
      });
      expect(button).toBeDisabled();

      act(() => {
        editorUpload.active = false;
        editorUpload.notify?.(false);
      });
      expect(button).toBeEnabled();
    });
  }

  it("does not adopt while the editor is uploading", async () => {
    const { ref, handle } = fakeEditorRef("hello wrld");
    renderUi(<PolishButton wsId="ws-1" editorRef={ref} context={ISSUE_CONTEXT} />);

    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));
    handle.hasActiveUploads.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    expect(handle.adoptContent).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("adopt replaces the editor content and closes", async () => {
    const { ref, handle } = fakeEditorRef("hello wrld");
    const onAdopted = vi.fn();
    renderUi(<PolishButton wsId="ws-1" editorRef={ref} context={ISSUE_CONTEXT} onAdopted={onAdopted} />);

    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    expect(handle.adoptContent).toHaveBeenCalledWith("Hello world.");
    expect(onAdopted).toHaveBeenCalledWith("Hello world.");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("PolishDialog", () => {
  it("shows original and polished side by side", async () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Polish message" });
    const before = within(dialog).getByLabelText("Before") as HTMLTextAreaElement;
    expect(before.value).toBe("hello wrld");
    expect(before).toHaveAttribute("readonly");
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));
    expect(apiPolishText).toHaveBeenCalledTimes(1);
    expect(apiPolishText).toHaveBeenCalledWith("ws-1", "hello wrld", ISSUE_CONTEXT);
  });

  it("disables the confirm button while polishing", async () => {
    const pending = deferred<{ text: string }>();
    apiPolishText.mockReturnValue(pending.promise);
    renderDialog();

    expect(screen.getByRole("button", { name: "Use" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Polishing");
    await act(async () => pending.resolve({ text: "Hello world." }));
    expect(screen.getByRole("button", { name: "Use" })).toBeEnabled();
  });

  it("polish again replaces the right side", async () => {
    apiPolishText
      .mockResolvedValueOnce({ text: "First try." })
      .mockResolvedValueOnce({ text: "Second try." });
    renderDialog();
    await waitFor(() => expect(afterTextarea().value).toBe("First try."));

    fireEvent.click(screen.getByRole("button", { name: "Polish" }));

    await waitFor(() => expect(afterTextarea().value).toBe("Second try."));
    expect(apiPolishText).toHaveBeenCalledTimes(2);
    expect(apiPolishText).toHaveBeenLastCalledWith("ws-1", "hello wrld", ISSUE_CONTEXT);
  });

  it("right side is editable and adopt uses the edited text", async () => {
    const { onConfirm } = renderDialog();
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));

    fireEvent.change(afterTextarea(), { target: { value: "Hello, world!" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Hello, world!"));
  });

  it("escape and outside click do not close", async () => {
    const { onClose } = renderDialog();
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));

    fireEvent.keyDown(afterTextarea(), { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    const backdrop = document.querySelector("[data-slot='dialog-overlay']");
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop!);
    fireEvent.mouseDown(backdrop!);
    fireEvent.click(backdrop!);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not blur the backdrop", () => {
    renderDialog();
    const backdrop = document.querySelector("[data-slot='dialog-overlay']");
    expect(backdrop?.className).not.toMatch(/backdrop-blur-xs/);
  });

  it("close button keeps the original", async () => {
    const { ref, handle } = fakeEditorRef("hello wrld");
    const onAdopted = vi.fn();
    renderUi(<PolishButton wsId="ws-1" editorRef={ref} context={ISSUE_CONTEXT} onAdopted={onAdopted} />);
    fireEvent.click(await screen.findByRole("button", { name: "Polish message" }));
    await waitFor(() => expect(afterTextarea().value).toBe("Hello world."));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(handle.adoptContent).not.toHaveBeenCalled();
    expect(onAdopted).not.toHaveBeenCalled();
  });

  it("failure keeps the original on the right and shows the error", async () => {
    apiPolishText.mockRejectedValueOnce(
      new ApiError("upstream", 502, "Bad Gateway", { error: "upstream_failed" }),
    );
    const { onConfirm } = renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't polish");
    expect(afterTextarea().value).toBe("hello wrld");
    const confirm = screen.getByRole("button", { name: "Use" });
    expect(confirm).toBeEnabled();
    expect(screen.getByRole("button", { name: "Polish" })).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("hello wrld"));
  });

  it("a failed regenerate keeps the previous result", async () => {
    apiPolishText
      .mockResolvedValueOnce({ text: "First try." })
      .mockRejectedValueOnce(new ApiError("upstream", 502, "Bad Gateway", { error: "upstream_failed" }));
    renderDialog();
    await waitFor(() => expect(afterTextarea().value).toBe("First try."));

    fireEvent.click(screen.getByRole("button", { name: "Polish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't polish");
    expect(afterTextarea().value).toBe("First try.");
    expect(screen.getByRole("button", { name: "Polish" })).toBeEnabled();
  });

  it("a failed regenerate keeps the user's edits", async () => {
    apiPolishText
      .mockResolvedValueOnce({ text: "First try." })
      .mockRejectedValueOnce(new ApiError("lost", 422, "Unprocessable Entity", { error: "polish_lost_spans" }));
    const { onConfirm } = renderDialog();
    await waitFor(() => expect(afterTextarea().value).toBe("First try."));
    fireEvent.change(afterTextarea(), { target: { value: "My own wording." } });

    fireEvent.click(screen.getByRole("button", { name: "Polish" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("mentions, links or code");
    expect(afterTextarea().value).toBe("My own wording.");
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("My own wording."));
  });

  it("explains a polish that dropped protected spans", async () => {
    apiPolishText.mockRejectedValueOnce(
      new ApiError("lost", 422, "Unprocessable Entity", { error: "polish_lost_spans" }),
    );
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("mentions, links or code");
    expect(afterTextarea().value).toBe("hello wrld");
  });

  it("send mode shows the turn-off hint", async () => {
    renderDialog({ mode: "send" }, "zh-Hant");

    expect(screen.getByText("AI 代理可能會出錯。")).toBeInTheDocument();
    expect(
      screen.getByText("如果想自己決定要不要優化，請到偏好設定 → 評論與聊天，關閉對話優化。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "採用" })).not.toBeInTheDocument();
    await waitFor(() => expect(apiPolishText).toHaveBeenCalled());
  });

  it("adopt mode leaves out the turn-off hint", () => {
    renderDialog({}, "zh-Hant");

    expect(screen.getByText("AI 代理可能會出錯。")).toBeInTheDocument();
    expect(screen.queryByText(/關閉對話優化/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "採用" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "對話優化" })).toBeInTheDocument();
    expect(screen.getByText("優化前")).toBeInTheDocument();
    expect(screen.getByText("優化後")).toBeInTheDocument();
  });
});

describe("PolishDialog display text", () => {
  it("shows links as labels, hides cards, and restores both on confirm", async () => {
    const card = "!file[a.txt](http://x/a.txt)";
    const original = `[@Bot](mention://agent/a1) see [E50-1](mention://issue/i1)

${card}`;
    apiPolishText.mockResolvedValue({
      text: `[@Bot](mention://agent/a1) please see [E50-1](mention://issue/i1)

${card}`,
    });
    const { onConfirm } = renderDialog({ original });

    const dialog = screen.getByRole("dialog", { name: "Polish message" });
    expect((within(dialog).getByLabelText("Before") as HTMLTextAreaElement).value).toBe("@Bot see E50-1");
    await waitFor(() => expect(afterTextarea().value).toBe("@Bot please see E50-1"));
    expect(apiPolishText).toHaveBeenCalledWith("ws-1", original, ISSUE_CONTEXT);

    fireEvent.change(afterTextarea(), { target: { value: "E50-1 first, @Bot" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        `[E50-1](mention://issue/i1) first, [@Bot](mention://agent/a1)

${card}`,
      ),
    );
  });
});
