"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { cn } from "@multica/ui/lib/utils";
import { useCommentComposerStore } from "@multica/core/issues/stores";
import { useT } from "../../i18n";
import { appendDecision, type Decision, type ExecutionMode } from "./decision";

export interface DecisionBarProps {
  decision: Decision | null;
  onDecisionChange: (decision: Decision | null) => void;
  disabled?: boolean;
}

const TRIGGER_CLASS = "h-7 w-auto gap-1 rounded-full px-2.5 text-caption";

/** Decision and execution pickers for chat, comment and reply composers. */
export function DecisionBar({ decision, onDecisionChange, disabled }: DecisionBarProps) {
  const { t } = useT("editor");
  const executionMode = useCommentComposerStore((s) => s.executionMode);
  const setExecutionMode = useCommentComposerStore((s) => s.setExecutionMode);
  const placeholder = t(($) => $.decision.placeholder);
  const decisionLabel = useDecisionLabel();
  // The placeholder doubles as the way back to "no decision".
  const decisionItems: { value: Decision | null; label: string }[] = [
    { value: null, label: placeholder },
    { value: "approve", label: decisionLabel("approve") },
    { value: "discuss", label: decisionLabel("discuss") },
  ];
  const modeItems: { value: ExecutionMode; label: string }[] = [
    { value: "single", label: t(($) => $.decision.single) },
    { value: "multi", label: t(($) => $.decision.multi) },
  ];

  return (
    <>
      <Select
        items={decisionItems}
        value={decision}
        disabled={disabled}
        onValueChange={(next) => onDecisionChange((next as Decision | null) ?? null)}
      >
        <SelectTrigger
          size="sm"
          className={TRIGGER_CLASS}
          aria-label={t(($) => $.decision.label)}
        >
          <SelectValue>
            <span className={cn(!decision && "text-muted-foreground")}>
              {decision ? decisionLabel(decision) : placeholder}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {decisionItems.map((item) => (
            <SelectItem
              key={item.value ?? "none"}
              value={item.value}
              className={cn(item.value === null && "text-muted-foreground")}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={modeItems}
        value={executionMode}
        disabled={disabled}
        onValueChange={(next) => {
          if (next && next !== executionMode) setExecutionMode(next as ExecutionMode);
        }}
      >
        <SelectTrigger
          size="sm"
          className={TRIGGER_CLASS}
          aria-label={t(($) => $.decision.execution_label)}
        >
          <SelectValue>
            {modeItems.find((item) => item.value === executionMode)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {modeItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function useDecisionLabel() {
  const { t } = useT("editor");
  return useCallback(
    (decision: Decision) =>
      decision === "approve" ? t(($) => $.decision.approve) : t(($) => $.decision.discuss),
    [t],
  );
}

export interface ComposerDecision {
  decision: Decision | null;
  setDecision: (decision: Decision | null) => void;
  /** Use inside the composer's `normalize`, so every send path carries it. */
  withDecision: (content: string) => string;
  /**
   * Call once the server accepted the send: clears the decision and, when
   * one went out with it, announces it with a "view" action.
   */
  settleSent: (onView: () => void) => void;
}

export function useComposerDecision(): ComposerDecision {
  const { t } = useT("editor");
  const decisionLabel = useDecisionLabel();
  const [decision, setDecision] = useState<Decision | null>(null);
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  // What the latest submit attempt carried; read back when it is accepted.
  const sentRef = useRef<Decision | null>(null);

  const withDecision = useCallback((content: string) => {
    sentRef.current = decisionRef.current;
    return appendDecision(
      content,
      decisionRef.current,
      useCommentComposerStore.getState().executionMode,
    );
  }, []);

  const settleSent = useCallback(
    (onView: () => void) => {
      const sent = sentRef.current;
      sentRef.current = null;
      if (!sent) return;
      setDecision(null);
      toast.success(t(($) => $.decision.sent, { label: decisionLabel(sent) }), {
        action: { label: t(($) => $.decision.view), onClick: onView },
      });
    },
    [decisionLabel, t],
  );

  return { decision, setDecision, withDecision, settleSent };
}
