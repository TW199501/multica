"use client";

import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useCommentComposerStore } from "@multica/core/issues/stores";
import { useCurrentWorkspace } from "@multica/core/paths";
import type { PolishContext } from "@multica/core/types";
import type { ContentEditorRef } from "../content-editor";
import { hasPolishableText } from "./display-text";
import { PolishDialog, type PolishDialogMode } from "./polish-dialog";
import { usePolishAvailable } from "./use-polish";

export interface PolishGateOptions {
  wsId: string;
  context: PolishContext;
  editorRef: RefObject<ContentEditorRef | null>;
  /**
   * The composer's own submit; the dialog's send runs exactly this and stays
   * open when it resolves false, so a refused send can retry the same text.
   */
  submit: () => Promise<boolean>;
  /** Syncs the composer's draft after the dialog text replaced the editor. */
  onAdopted?: (markdown: string) => void;
  /**
   * False while the composer cannot send (in flight, read-only, busy agent).
   * A send is then passed straight to `submit`, which refuses it, and the
   * polish button opens the dialog with "use" instead of "send".
   */
  canSend?: boolean;
  /** True when a send without text still says something (a chosen decision). */
  allowEmptySend?: boolean;
}

export interface PolishGate {
  /** Use for the send button and the editor's send shortcut. */
  gatedSubmit: () => Promise<void>;
  /** Use for the composer's polish button: its dialog sends like the send button. */
  openPolish: () => void;
  /** True while the dialog is open. */
  polishing: boolean;
  dialog: ReactNode;
}

interface OpenDialog {
  original: string;
  mode: PolishDialogMode;
  /** True when a send opened it, so the dialog says how to turn that off. */
  fromSend: boolean;
}

/**
 * The polish dialog of a sending composer. With the "polish before sending"
 * preference on, sends open it instead of going out; the polish button opens
 * it too. Its send puts the polished text into the editor and runs the
 * composer's own submit, so attachments, mentions and the decision go with it.
 */
export function usePolishGate({
  wsId,
  context,
  editorRef,
  submit,
  onAdopted,
  canSend = true,
  allowEmptySend = false,
}: PolishGateOptions): PolishGate {
  const polishOnSend = useCommentComposerStore((s) => s.polishOnSend);
  const available = usePolishAvailable(wsId);
  const [opened, setOpened] = useState<OpenDialog | null>(null);
  const stateRef = useRef({ polishOnSend, available, canSend, submit, onAdopted, open: false });
  stateRef.current = {
    polishOnSend,
    available,
    canSend,
    submit,
    onAdopted,
    open: opened !== null,
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
      !hasPolishableText(markdown) ||
      editor?.hasActiveUploads()
    ) {
      await state.submit();
      return;
    }
    setOpened({ original: markdown, mode: "send", fromSend: true });
  }, [editorRef]);

  const openPolish = useCallback(() => {
    const state = stateRef.current;
    if (state.open || !state.available) return;
    const editor = editorRef.current;
    const markdown = editor?.getMarkdown() ?? "";
    if (!hasPolishableText(markdown) || editor?.hasActiveUploads()) return;
    setOpened({ original: markdown, mode: state.canSend ? "send" : "adopt", fromSend: false });
  }, [editorRef]);

  const confirm = useCallback(
    async (markdown: string) => {
      // Replacing the document mid-upload would drop the upload's placeholder
      // node and strand the file; keep the dialog open until it settles.
      if (editorRef.current?.hasActiveUploads()) return;
      editorRef.current?.adoptContent(markdown);
      // Commit before sending: the composer routes recipients from its rendered
      // draft, and a run must not be stopped for a mention the dialog removed.
      flushSync(() => stateRef.current.onAdopted?.(markdown));
      if (opened?.mode === "send" && !(await stateRef.current.submit())) return;
      setOpened(null);
    },
    [editorRef, opened?.mode],
  );

  const dialog = (
    <PolishDialog
      open={opened !== null}
      mode={opened?.mode ?? "send"}
      wsId={wsId}
      original={opened?.original ?? ""}
      context={context}
      onClose={() => setOpened(null)}
      onConfirm={confirm}
      allowEmpty={opened?.mode === "send" && allowEmptySend}
      showTurnOffHint={opened?.fromSend ?? false}
    />
  );

  return { gatedSubmit, openPolish, polishing: opened !== null, dialog };
}

/** usePolishGate for composers, bound to the workspace of the current route. */
export function useWorkspacePolishGate(opts: Omit<PolishGateOptions, "wsId">): PolishGate {
  const wsId = useCurrentWorkspace()?.id ?? "";
  return usePolishGate({ ...opts, wsId });
}
