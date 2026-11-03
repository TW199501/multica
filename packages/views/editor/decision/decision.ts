import type { ExecutionMode } from "@multica/core/issues/stores";

export type { ExecutionMode };

/** What a gate message decides: start the work, or keep discussing. */
export type Decision = "approve" | "discuss";

// Fixed in every locale: the first line is what the approval gate matches,
// the second names the official superpowers skill for the agent.
const DECISION_LINE: Record<Decision, string> = {
  approve: "決議：核准執行",
  discuss: "決議：再議討論",
};

const INSTRUCTION_LINE = {
  multi: "Use superpowers:subagent-driven-development",
  single: "Use superpowers:executing-plans",
  discuss: "Do not start. Wait for further discussion.",
} as const;

/** Appends the decision block after a blank line; `null` leaves the text untouched. */
export function appendDecision(
  content: string,
  decision: Decision | null,
  mode: ExecutionMode,
): string {
  if (!decision) return content;
  const instruction =
    decision === "approve" ? INSTRUCTION_LINE[mode] : INSTRUCTION_LINE.discuss;
  const block = `${DECISION_LINE[decision]}\n${instruction}`;
  return content.trim() ? `${content}\n\n${block}` : block;
}
