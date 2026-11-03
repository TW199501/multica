"use client";

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { useCommentComposerStore } from "@multica/core/issues/stores";
import { useCurrentWorkspace } from "@multica/core/paths";
import type { PolishContext } from "@multica/core/types";
import type { ContentEditorRef } from "../content-editor";
import { PolishDialog } from "./polish-dialog";
import { usePolishAvailable } from "./use-polish";

export interface PolishGateOptions {
  wsId: string;
  context: PolishContext;
  editorRef: RefObject<ContentEditorRef | null>;
  /** The composer's own submit; the dialog's send runs exactly this. */
  submit: () => Promise<void>;
  /** Syncs the composer's draft after the dialog text replaced the editor. */
  onAdopted?: (markdown: string) => void;
  /**
   * False while the composer cannot send (in flight, read-only, busy agent).
   * The send is then passed straight to `submit`, which refuses it, instead
   * of opening a dialog whose send would do nothing.
   */
  canSend?: boolean;
}

export interface PolishGate {
  /** Use for the send button and the editor's send shortcut. */
  gatedSubmit: () => Promise<void>;
  dialog: ReactNode;
}

/**
 * With the "polish before sending" preference on, sends open the polish
 * dialog instead of going out; its send puts the polished text into the
 * editor and runs the composer's own submit.
 */
export function usePolishGate({
  wsId,
  context,
  editorRef,
  submit,
  onAdopted,
  canSend = true,
}: PolishGateOptions): PolishGate {
  const polishOnSend = useCommentComposerStore((s) => s.polishOnSend);
  const available = usePolishAvailable(wsId);
  // The text captured when the dialog opened; null while closed.
  const [original, setOriginal] = useState<string | null>(null);
  const stateRef = useRef({ polishOnSend, available, canSend, submit, onAdopted, open: false });
  stateRef.current = {
    polishOnSend,
    available,
    canSend,
    submit,
    onAdopted,
    open: original !== null,
  };

  const gatedSubmit = useCallback(async () => {
    const state = stateRef.current;
    if (state.open) return;
    const editor = editorRef.current;
    const markdown = editor?.getMarkdown() ?? "";
    if (
      !state.polishOnSend ||
      !state.available ||
      !state.canSend ||
      !markdown.trim() ||
      editor?.hasActiveUploads()
    ) {
      await state.submit();
      return;
    }
    setOriginal(markdown);
  }, [editorRef]);

  const send = useCallback(
    async (markdown: string) => {
      // Replacing the document mid-upload would drop the upload's placeholder
      // node and strand the file; keep the dialog open until it settles.
      if (editorRef.current?.hasActiveUploads()) return;
      editorRef.current?.adoptContent(markdown);
      stateRef.current.onAdopted?.(markdown);
      await stateRef.current.submit();
      setOriginal(null);
    },
    [editorRef],
  );

  const dialog = (
    <PolishDialog
      open={original !== null}
      mode="send"
      wsId={wsId}
      original={original ?? ""}
      context={context}
      onClose={() => setOriginal(null)}
      onConfirm={send}
    />
  );

  return { gatedSubmit, dialog };
}

/** usePolishGate for composers, bound to the workspace of the current route. */
export function useWorkspacePolishGate(opts: Omit<PolishGateOptions, "wsId">): PolishGate {
  const wsId = useCurrentWorkspace()?.id ?? "";
  return usePolishGate({ ...opts, wsId });
}
