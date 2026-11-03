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

const TRIGGER_CLASS = "h-7 w-auto gap-1 rounded-full px-2.5 text-caption font-normal";

/**
 * Decision picker for chat, comment and reply composers. The execution picker
 * only appears once the decision is "approve", the one decision it applies to.
 */
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
      {decision === "approve" && (
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
            className={cn(TRIGGER_CLASS, "text-muted-foreground")}
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
      )}
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
  /** The remembered execution mode the decision is sent with. */
  executionMode: ExecutionMode;
  /**
   * Use inside the composer's `normalize`, so every send path carries it.
   * `include: false` sends the text alone (a send the user did not compose).
   */
  withDecision: (content: string, include?: boolean) => string;
  /**
   * Call once the server accepted the send: clears the decision and, when
   * one went out with it, announces it with a "view" action.
   */
  settleSent: (onView: () => void) => void;
}

/**
 * The decision belongs to what is being composed: when `scopeKey` changes
 * (chat switching sessions in the same composer) it starts over unset.
 */
export function useComposerDecision(scopeKey = ""): ComposerDecision {
  const { t } = useT("editor");
  const decisionLabel = useDecisionLabel();
  const executionMode = useCommentComposerStore((s) => s.executionMode);
  const [scoped, setScoped] = useState<{ key: string; decision: Decision | null }>({
    key: scopeKey,
    decision: null,
  });
  if (scoped.key !== scopeKey) setScoped({ key: scopeKey, decision: null });
  const decision = scoped.key === scopeKey ? scoped.decision : null;
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  // What the latest submit attempt carried; read back when it is accepted.
  const sentRef = useRef<Decision | null>(null);

  const setDecision = useCallback((next: Decision | null) => {
    setScoped({ key: scopeKeyRef.current, decision: next });
  }, []);

  const withDecision = useCallback((content: string, include = true) => {
    const current = include ? decisionRef.current : null;
    sentRef.current = current;
    return appendDecision(content, current, useCommentComposerStore.getState().executionMode);
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
    [decisionLabel, setDecision, t],
  );

  return { decision, setDecision, executionMode, withDecision, settleSent };
}
