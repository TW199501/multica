"use client";

import { useState, type RefObject } from "react";
import { Sparkles } from "@multica/ui/icons";
import { Button } from "@multica/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { cn } from "@multica/ui/lib/utils";
import { useCurrentWorkspace } from "@multica/core/paths";
import type { PolishContext } from "@multica/core/types";
import type { ContentEditorRef } from "../content-editor";
import { useT } from "../../i18n";
import { hasPolishableText } from "./display-text";
import { PolishDialog } from "./polish-dialog";
import { usePolishAvailable } from "./use-polish";

export interface PolishButtonProps {
  wsId: string;
  editorRef: RefObject<ContentEditorRef | null>;
  context: PolishContext;
  /**
   * Called after the polished text replaced the editor content.
   * `adoptContent` does not fire the editor's onUpdate, so composers sync
   * their own draft here.
   */
  onAdopted?: (markdown: string) => void;
  /** Pass true while the editor is empty, an upload is in flight, or the composer cannot send. */
  disabled?: boolean;
  /**
   * The composer's polish gate. When given, the button opens the gate's
   * dialog, whose button sends; without it the button keeps its own "use"
   * dialog (editing a comment, creating an issue).
   */
  gate?: { openPolish: () => void; polishing: boolean };
}

export function PolishButton({ wsId, editorRef, context, onAdopted, disabled, gate }: PolishButtonProps) {
  const { t } = useT("editor");
  const available = usePolishAvailable(wsId);
  // The text captured when the dialog opened; null while closed.
  const [original, setOriginal] = useState<string | null>(null);

  if (!available) return null;

  const label = t(($) => $.polish.button);
  const polishing = gate ? gate.polishing : original !== null;
  const openDialog = () => {
    if (gate) {
      gate.openPolish();
      return;
    }
    const editor = editorRef.current;
    const markdown = editor?.getMarkdown() ?? "";
    if (!hasPolishableText(markdown) || editor?.hasActiveUploads()) return;
    setOriginal(markdown);
  };
  const adopt = (markdown: string) => {
    // Replacing the document mid-upload would drop the upload's placeholder
    // node and strand the file; keep the dialog open until it settles.
    if (editorRef.current?.hasActiveUploads()) return;
    editorRef.current?.adoptContent(markdown);
    onAdopted?.(markdown);
    setOriginal(null);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label={label}
              disabled={disabled}
              onClick={openDialog}
            />
          }
        >
          <Sparkles
            aria-hidden="true"
            className={cn(polishing && "animate-pulse [animation-duration:1.8s]")}
          />
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <PolishDialog
        open={!gate && original !== null}
        mode="adopt"
        wsId={wsId}
        original={original ?? ""}
        context={context}
        onClose={() => setOriginal(null)}
        onConfirm={adopt}
      />
    </>
  );
}

/** PolishButton for composers, bound to the workspace of the current route. */
export function WorkspacePolishButton(props: Omit<PolishButtonProps, "wsId">) {
  const wsId = useCurrentWorkspace()?.id ?? "";
  return <PolishButton wsId={wsId} {...props} />;
}
