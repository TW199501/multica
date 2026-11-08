import { parseMentions } from "@multica/core/issues/comment-trigger-outcomes";
import type { CommentDraftKey } from "@multica/core/issues/stores";
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
  /** Set on rows that hold a comment thread. */
  comment?: { count: number; latestAt: string };
}

export interface AgentFoldMember {
  /** The first agent comment's row id, which stays stable as newer rows arrive. */
  foldId: string;
  isHead: boolean;
  /** Comments in the fold, counting every reply in its threads. */
  count: number;
}

/** Whether someone has unsent reply content waiting under this draft key. */
export function hasPendingReply(
  state: {
    getDraft: (key: CommentDraftKey) => string | undefined;
    getAnnotations: (key: CommentDraftKey) => readonly unknown[];
    getUploads: (key: CommentDraftKey) => readonly unknown[];
  },
  key: CommentDraftKey,
): boolean {
  return (
    !!state.getDraft(key)?.trim() ||
    state.getAnnotations(key).length > 0 ||
    state.getUploads(key).length > 0
  );
}

/**
 * Plan which timeline rows collapse behind an "N agent comments" row. The
 * thread holding the newest comment always stays visible, because an agent's
 * final report often mentions nobody and must not disappear.
 */
export function planAgentFolds(rows: readonly AgentFoldRow[]): Map<string, AgentFoldMember> {
  const plan = new Map<string, AgentFoldMember>();
  let newestCommentIndex = -1;
  let newestAt = Number.NEGATIVE_INFINITY;
  rows.forEach((row, index) => {
    if (!row.comment) return;
    const at = Date.parse(row.comment.latestAt);
    if (at >= newestAt) {
      newestAt = at;
      newestCommentIndex = index;
    }
  });

  let members: AgentFoldRow[] = [];
  let pendingTransparent: AgentFoldRow[] = [];
  const closeFold = () => {
    const head = members[0];
    if (head) {
      const count = members.reduce((sum, member) => sum + (member.comment?.count ?? 0), 0);
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
