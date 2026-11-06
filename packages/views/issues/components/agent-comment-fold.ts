import { parseMentions } from "@multica/core/issues/comment-trigger-outcomes";
import type { TimelineEntry } from "@multica/core/types";

const HUMAN_MENTION_TYPES = new Set(["member", "all"]);

function addressesHuman(entry: TimelineEntry): boolean {
  return parseMentions(entry.content ?? "").some((mention) => HUMAN_MENTION_TYPES.has(mention.type));
}

/** A thread only agents wrote in, with nobody human mentioned. */
export function isAgentOnlyThread(
  root: TimelineEntry,
  replies: readonly TimelineEntry[],
): boolean {
  return [root, ...replies].every(
    (entry) => entry.actor_type === "agent" && !addressesHuman(entry),
  );
}

export interface AgentFoldRow {
  id: string;
  /**
   * `transparent` rows are already compact, so they stay inside a fold when
   * agent comments surround them instead of splitting it into several rows.
   */
  role: "foldable" | "transparent" | "visible";
  isComment: boolean;
}

export interface AgentFoldMember {
  /** The first agent comment's row id, which stays stable as newer rows arrive. */
  foldId: string;
  isHead: boolean;
  /** Agent comments in the fold, excluding absorbed transparent rows. */
  count: number;
}

/**
 * Plan which timeline rows collapse behind an "N agent comments" row. The
 * newest comment always stays visible, because an agent's final report often
 * mentions nobody and must not disappear.
 */
export function planAgentFolds(rows: readonly AgentFoldRow[]): Map<string, AgentFoldMember> {
  const plan = new Map<string, AgentFoldMember>();
  let newestCommentIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.isComment) {
      newestCommentIndex = i;
      break;
    }
  }

  let members: AgentFoldRow[] = [];
  let pendingTransparent: AgentFoldRow[] = [];
  const closeFold = () => {
    const head = members[0];
    if (head) {
      const count = members.filter((member) => member.role === "foldable").length;
      for (const member of members) {
        plan.set(member.id, { foldId: head.id, isHead: member === head, count });
      }
    }
    members = [];
    pendingTransparent = [];
  };

  rows.forEach((row, index) => {
    if (row.role === "foldable" && index !== newestCommentIndex) {
      members.push(...pendingTransparent, row);
      pendingTransparent = [];
    } else if (row.role === "transparent" && members.length > 0) {
      pendingTransparent.push(row);
    } else if (row.role !== "transparent") {
      closeFold();
    }
  });
  closeFold();
  return plan;
}
