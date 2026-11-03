"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Sparkles, X } from "@multica/ui/icons";
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
import { clampDialogOffset, type DialogOffset } from "./clamp-dialog-offset";
import { fromDisplayText, toDisplayText } from "./display-text";

export type PolishDialogMode = "adopt" | "send";

export interface PolishDialogProps {
  open: boolean;
  /** `adopt` puts the text back into the composer; `send` sends it. */
  mode: PolishDialogMode;
  wsId: string;
  original: string;
  context: PolishContext;
  /** Called only by the title-bar close button, which `send` mode disables while confirming. */
  onClose: () => void;
  onConfirm: (markdown: string) => void | Promise<void>;
  /** Lets the confirm button take a blank right column; off, blank text cannot be confirmed. */
  allowEmpty?: boolean;
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
  allowEmpty = false,
}: PolishDialogProps) {
  const { t } = useT("editor");
  const { mutateAsync: polishText } = usePolishText(wsId);
  const beforeId = useId();
  const afterId = useId();
  // Both columns show the readable form; links and cards return on confirm.
  const view = useMemo(() => toDisplayText(original), [original]);
  const [polished, setPolished] = useState(view.text);
  const [error, setError] = useState<PolishError | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [offset, setOffset] = useState<DialogOffset>({ x: 0, y: 0 });
  const dragRef = useRef<DragStart | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const titleBarRef = useRef<HTMLDivElement>(null);
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
        setPolished(toDisplayText(result.text).text);
        setLoading(false);
      },
      (err: unknown) => {
        if (id !== requestRef.current) return;
        // The right column already holds the original (set on open) until a
        // result or an edit replaces it, so leaving it untouched shows the
        // original after a first failure and keeps earlier work after a retry.
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
    setPolished(toDisplayText(inputRef.current.original).text);
    setConfirming(false);
    setOffset({ x: 0, y: 0 });
    runPolish();
  }, [open, runPolish]);

  // The title bar holds the only way to close the dialog, so it must never
  // leave the viewport — pointer capture keeps reporting moves past its edges.
  const keepOnScreen = useCallback((next: DialogOffset): DialogOffset => {
    const popup = popupRef.current;
    if (!popup) return next;
    const rect = popup.getBoundingClientRect();
    return clampDialogOffset(next, {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dialogWidth: rect.width,
      dialogHeight: rect.height,
      titleBarHeight: titleBarRef.current?.offsetHeight ?? 0,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setOffset((current) => keepOnScreen(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, keepOnScreen]);

  const confirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(fromDisplayText(polished, view.map));
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
    setOffset(
      keepOnScreen({
        x: start.offsetX + event.clientX - start.pointerX,
        y: start.offsetY + event.clientY - start.pointerY,
      }),
    );
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
          ref={popupRef}
          data-slot="dialog-content"
          // Position through left/top rather than transform so dragging does
          // not fight the centring translate and the open/close animation.
          style={{ left: `calc(50% + ${offset.x}px)`, top: `calc(50% + ${offset.y}px)` }}
          className="fixed z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-xl bg-surface-raised p-4 text-body text-popover-foreground shadow-[var(--floating-shadow)] ring-1 ring-surface-border outline-none data-open:duration-[var(--dialog-enter-duration)] data-closed:duration-[var(--dialog-exit-duration)] data-open:ease-[var(--dialog-enter-easing)] data-closed:ease-[var(--dialog-exit-easing)] motion-reduce:animate-none! data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <div
            ref={titleBarRef}
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
              // A send in flight still lands; closing then would only hide it.
              disabled={mode === "send" && confirming}
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
                value={view.text}
                className="min-h-48 flex-1 resize-none text-muted-foreground"
              />
            </div>
            <div className="flex min-h-0 flex-col gap-1.5">
              <label htmlFor={afterId} className="text-caption font-medium text-muted-foreground">
                {t(($) => $.polish.after)}
              </label>
              {errorText && (
                <p role="alert" className="text-right text-caption text-destructive">
                  {errorText}
                </p>
              )}
              {loading ? (
                <div
                  role="status"
                  className="flex min-h-48 flex-1 items-center justify-center gap-2 rounded-lg border border-input text-caption text-muted-foreground"
                >
                  <Sparkles className="size-4 animate-pulse [animation-duration:1.8s]" aria-hidden="true" />
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
                disabled={busy || (!allowEmpty && !polished.trim())}
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
