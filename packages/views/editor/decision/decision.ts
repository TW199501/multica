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

const BLOCKS: { decision: Decision; mode: ExecutionMode | null; block: string }[] = [
  { decision: "approve", mode: "multi", block: `${DECISION_LINE.approve}\n${INSTRUCTION_LINE.multi}` },
  { decision: "approve", mode: "single", block: `${DECISION_LINE.approve}\n${INSTRUCTION_LINE.single}` },
  { decision: "discuss", mode: null, block: `${DECISION_LINE.discuss}\n${INSTRUCTION_LINE.discuss}` },
];

export interface SplitDecision {
  /** The text without its trailing decision block. */
  text: string;
  decision: Decision | null;
  /** Set only for an approval; a discussion carries no execution mode. */
  mode: ExecutionMode | null;
}

/**
 * Separates a trailing decision block — exactly as `appendDecision` writes
 * it — from the text before it. Text without one comes back unchanged.
 */
export function splitDecision(content: string): SplitDecision {
  const trimmed = content.replace(/\s+$/, "");
  for (const { decision, mode, block } of BLOCKS) {
    if (trimmed === block) return { text: "", decision, mode };
    if (trimmed.endsWith(`\n\n${block}`)) {
      return { text: trimmed.slice(0, -block.length).replace(/\s+$/, ""), decision, mode };
    }
  }
  return { text: content, decision: null, mode: null };
}

/**
 * Appends the decision block after a blank line, replacing a block the text
 * already ends with; `null` leaves the text untouched.
 */
export function appendDecision(
  content: string,
  decision: Decision | null,
  mode: ExecutionMode,
): string {
  if (!decision) return content;
  const base = splitDecision(content).text;
  const instruction =
    decision === "approve" ? INSTRUCTION_LINE[mode] : INSTRUCTION_LINE.discuss;
  const block = `${DECISION_LINE[decision]}\n${instruction}`;
  return base.trim() ? `${base}\n\n${block}` : block;
}
