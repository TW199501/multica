"use client";

import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Loader2, X } from "@multica/ui/icons";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Dialog,
  DialogFooter,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { cn } from "@multica/ui/lib/utils";
import { aiErrorCode } from "@multica/core/api";
import type { PolishContext } from "@multica/core/types";
import { usePolishText } from "@multica/core/workspace/mutations";
import { useT } from "../../i18n";

export type PolishDialogMode = "adopt" | "send";

export interface PolishDialogProps {
  open: boolean;
  /** `adopt` puts the text back into the composer; `send` sends it. */
  mode: PolishDialogMode;
  wsId: string;
  original: string;
  context: PolishContext;
  /** Called only by the title-bar close button. */
  onClose: () => void;
  onConfirm: (markdown: string) => void | Promise<void>;
}

type PolishError = "lost_spans" | "not_configured" | "failed";

function polishError(err: unknown): PolishError {
  switch (aiErrorCode(err)) {
    case "polish_lost_spans":
      return "lost_spans";
    case "ai_not_configured":
      return "not_configured";
    default:
      return "failed";
  }
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
}

export function PolishDialog({
  open,
  mode,
  wsId,
  original,
  context,
  onClose,
  onConfirm,
}: PolishDialogProps) {
  const { t } = useT("editor");
  const { mutateAsync: polishText } = usePolishText(wsId);
  const beforeId = useId();
  const afterId = useId();
  const [polished, setPolished] = useState(original);
  const [error, setError] = useState<PolishError | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragStart | null>(null);
  // Bumped per request and on close, so a slow response never overwrites a
  // newer one or lands in a dialog that has since been reopened.
  const requestRef = useRef(0);
  const inputRef = useRef({ original, context });
  inputRef.current = { original, context };

  const runPolish = useCallback(() => {
    const id = ++requestRef.current;
    const { original: text, context: ctx } = inputRef.current;
    setLoading(true);
    setError(null);
    polishText({ text, context: ctx }).then(
      (result) => {
        if (id !== requestRef.current) return;
        setPolished(result.text);
        setLoading(false);
      },
      (err: unknown) => {
        if (id !== requestRef.current) return;
        // The original stays usable so a failed polish never blocks the user.
        setPolished(text);
        setError(polishError(err));
        setLoading(false);
      },
    );
  }, [polishText]);

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    setPolished(inputRef.current.original);
    setConfirming(false);
    setOffset({ x: 0, y: 0 });
    runPolish();
  }, [open, runPolish]);

  const confirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(polished);
    } catch {
      // The caller reports its own failure; staying open lets the user retry.
    } finally {
      setConfirming(false);
    }
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    setOffset({
      x: start.offsetX + event.clientX - start.pointerX,
      y: start.offsetY + event.clientY - start.pointerY,
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const busy = loading || confirming;
  const errorText =
    error === "lost_spans"
      ? t(($) => $.polish.error_lost_spans)
      : error === "not_configured"
        ? t(($) => $.polish.error_not_configured)
        : error === "failed"
          ? t(($) => $.polish.error_failed)
          : null;

  return (
    // Controlled with no onOpenChange: Esc and outside press must not close
    // this dialog, only the title-bar X does, so a polish is never skipped by
    // a stray key or click.
    <Dialog open={open} disablePointerDismissal>
      <DialogPortal>
        <DialogOverlay className="supports-backdrop-filter:backdrop-blur-none" />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          // Position through left/top rather than transform so dragging does
          // not fight the centring translate and the open/close animation.
          style={{ left: `calc(50% + ${offset.x}px)`, top: `calc(50% + ${offset.y}px)` }}
          className="fixed z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-xl bg-surface-raised p-4 text-body text-popover-foreground shadow-[var(--floating-shadow)] ring-1 ring-surface-border outline-none data-open:duration-[var(--dialog-enter-duration)] data-closed:duration-[var(--dialog-exit-duration)] data-open:ease-[var(--dialog-enter-easing)] data-closed:ease-[var(--dialog-exit-easing)] motion-reduce:animate-none! data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <div
            className="-mx-4 -mt-4 flex cursor-move touch-none items-center justify-between gap-2 border-b border-surface-border py-2 pr-2 pl-4 select-none"
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <DialogTitle>{t(($) => $.polish.title)}</DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(($) => $.polish.close)}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto sm:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-1.5">
              <label htmlFor={beforeId} className="text-caption font-medium text-muted-foreground">
                {t(($) => $.polish.before)}
              </label>
              <Textarea
                id={beforeId}
                readOnly
                value={original}
                className="min-h-48 flex-1 resize-none text-muted-foreground"
              />
            </div>
            <div className="flex min-h-0 flex-col gap-1.5">
              <label htmlFor={afterId} className="text-caption font-medium text-muted-foreground">
                {t(($) => $.polish.after)}
              </label>
              {errorText && (
                <p role="alert" className="text-caption text-destructive">
                  {errorText}
                </p>
              )}
              {loading ? (
                <div
                  role="status"
                  className="flex min-h-48 flex-1 items-center justify-center gap-2 rounded-lg border border-input text-caption text-muted-foreground"
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t(($) => $.polish.loading)}
                </div>
              ) : (
                <Textarea
                  id={afterId}
                  value={polished}
                  onChange={(event) => setPolished(event.target.value)}
                  className="min-h-48 flex-1 resize-none"
                />
              )}
            </div>
          </div>
          <DialogFooter className="sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5 text-caption text-muted-foreground">
              <p>{t(($) => $.polish.disclaimer)}</p>
              {mode === "send" && <p>{t(($) => $.polish.turn_off_hint)}</p>}
            </div>
            <div className="flex shrink-0 justify-end gap-2">
              <Button variant="outline" onClick={runPolish} disabled={busy}>
                {t(($) => $.polish.regenerate)}
              </Button>
              <Button
                onClick={() => void confirm()}
                disabled={busy}
                aria-busy={confirming || undefined}
                className={cn(confirming && "cursor-wait")}
              >
                {mode === "send" ? t(($) => $.polish.send) : t(($) => $.polish.adopt)}
              </Button>
            </div>
          </DialogFooter>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
