import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { vi } from "vitest";

/**
 * Shared doubles for composer tests that drive chat, comment and reply
 * composers end to end. Use from a `vi.mock` factory through a dynamic
 * import so the factory and the test share these singletons:
 *
 *   vi.mock("..", async () => (await import("../../test/composer-mocks")).editorModule());
 */
export const mockEditorState = {
  uploading: false,
  notifyUploading: undefined as ((uploading: boolean) => void) | undefined,
  /** Holds back onUpdate, like the real editor inside its debounce window. */
  holdUpdates: false,
};

export async function editorModule(): Promise<Record<string, unknown>> {
  return {
    ...(await vi.importActual<typeof import("../editor/use-lazy-editor")>("../editor/use-lazy-editor")),
    ...(await vi.importActual<typeof import("../editor/use-upload-gate")>("../editor/use-upload-gate")),
    ...(await vi.importActual<typeof import("../editor/use-composer-submit")>("../editor/use-composer-submit")),
    useEditorUpload: () => ({ uploadWithToast: vi.fn(), upload: vi.fn(), uploading: false }),
    useFileDropZone: () => ({ isDragOver: false, dropZoneProps: {} }),
    FileDropOverlay: () => null,
    ContentEditor: MockContentEditor,
  };
}

// Mirrors the real handle where it matters: `adoptContent` replaces the
// document without firing onUpdate, and plain Enter runs the send shortcut.
const MockContentEditor = forwardRef(function MockContentEditor(
  {
    defaultValue,
    value,
    onUpdate,
    onReady,
    onUploadingChange,
    onSubmit,
    placeholder,
  }: {
    defaultValue?: string;
    value?: string;
    onUpdate?: (markdown: string) => void;
    onReady?: () => void;
    onUploadingChange?: (uploading: boolean) => void;
    onSubmit?: () => void;
    placeholder?: string;
  },
  ref: Ref<unknown>,
) {
  mockEditorState.notifyUploading = onUploadingChange;
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
    hasActiveUploads: () => mockEditorState.uploading,
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
        if (!mockEditorState.holdUpdates) onUpdate?.(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmit?.();
        }
      }}
    />
  );
});

const noop = (..._args: unknown[]): void => {};

export const mockChatState = {
  activeSessionId: null as string | null,
  selectedAgentId: "agent-1",
  inputDrafts: {} as Record<string, string>,
  inputDraftAttachments: {} as Record<string, unknown[]>,
  setInputDraft: (key: string, value: string) => {
    mockChatState.inputDrafts[key] = value;
  },
  appendToInputDraft: noop,
  setInputDraftAttachments: noop,
  addInputDraftUpload: noop,
  settleInputDraftUpload: noop,
  failInputDraftUpload: noop,
  removeInputDraftUpload: noop,
  clearInputDraft: (key: string) => {
    delete mockChatState.inputDrafts[key];
  },
};

export function chatModule(): Record<string, unknown> {
  return {
    DRAFT_NEW_SESSION: "__draft_new__",
    useChatStore: Object.assign(
      (selector?: (s: typeof mockChatState) => unknown) =>
        selector ? selector(mockChatState) : mockChatState,
      { getState: () => mockChatState },
    ),
  };
}

export function resetComposerMocks() {
  mockEditorState.uploading = false;
  mockEditorState.notifyUploading = undefined;
  mockEditorState.holdUpdates = false;
  mockChatState.activeSessionId = null;
  mockChatState.inputDrafts = {};
}
