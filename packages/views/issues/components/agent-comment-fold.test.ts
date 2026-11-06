// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@multica/core/types";
import {
  isAgentOnlyThread,
  planAgentFolds,
  type AgentFoldRow,
} from "./agent-comment-fold";

const MEMBER_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";

function comment(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    type: "comment",
    id: "c1",
    actor_type: "agent",
    actor_id: AGENT_ID,
    content: "Pixel, please fix the format check.",
    created_at: "2026-11-07T00:00:00Z",
    ...overrides,
  } as TimelineEntry;
}

const agentRow = (id: string): AgentFoldRow => ({ id, role: "foldable", isComment: true });
const visibleComment = (id: string): AgentFoldRow => ({ id, role: "visible", isComment: true });
const activityRow = (id: string): AgentFoldRow => ({ id, role: "transparent", isComment: false });

describe("isAgentOnlyThread", () => {
  it("accepts an agent comment that addresses nobody", () => {
    expect(isAgentOnlyThread(comment(), [])).toBe(true);
  });

  it("accepts a thread where another agent is mentioned", () => {
    const root = comment({ content: `[@Pixel](mention://agent/${AGENT_ID}) please fix it` });
    expect(isAgentOnlyThread(root, [comment({ id: "r1" })])).toBe(true);
  });

  it("rejects a thread started by a member", () => {
    expect(isAgentOnlyThread(comment({ actor_type: "member" }), [])).toBe(false);
  });

  it("rejects a thread a member replied in", () => {
    const reply = comment({ id: "r1", actor_type: "member" });
    expect(isAgentOnlyThread(comment(), [reply])).toBe(false);
  });

  it("rejects a comment that mentions a member", () => {
    const root = comment({ content: `[@Eddie](mention://member/${MEMBER_ID}) please decide` });
    expect(isAgentOnlyThread(root, [])).toBe(false);
  });

  it("rejects a reply that mentions a member", () => {
    const reply = comment({ id: "r1", content: `[@Eddie](mention://member/${MEMBER_ID}) ready` });
    expect(isAgentOnlyThread(comment(), [reply])).toBe(false);
  });

  it("rejects a comment that mentions everyone", () => {
    expect(isAgentOnlyThread(comment({ content: "[@all](mention://all/all) heads up" }), [])).toBe(false);
  });
});

describe("planAgentFolds", () => {
  it("never folds the newest comment", () => {
    expect(planAgentFolds([agentRow("a")]).size).toBe(0);
  });

  it("folds consecutive agent comments under the first one", () => {
    const plan = planAgentFolds([agentRow("a"), agentRow("b"), agentRow("latest")]);
    expect(plan.get("a")).toEqual({ foldId: "a", isHead: true, count: 2 });
    expect(plan.get("b")).toEqual({ foldId: "a", isHead: false, count: 2 });
    expect(plan.has("latest")).toBe(false);
  });

  it("starts a new fold after a visible comment", () => {
    const plan = planAgentFolds([
      agentRow("a"),
      visibleComment("human"),
      agentRow("b"),
      agentRow("latest"),
    ]);
    expect(plan.get("a")?.foldId).toBe("a");
    expect(plan.get("b")).toEqual({ foldId: "b", isHead: true, count: 1 });
    expect(plan.has("human")).toBe(false);
  });

  it("absorbs activity between agent comments without counting it", () => {
    const plan = planAgentFolds([
      agentRow("a"),
      activityRow("activity"),
      agentRow("b"),
      agentRow("latest"),
    ]);
    expect(plan.get("activity")).toEqual({ foldId: "a", isHead: false, count: 2 });
    expect(plan.get("a")?.count).toBe(2);
  });

  it("leaves activity outside a fold visible", () => {
    const plan = planAgentFolds([
      activityRow("before"),
      agentRow("a"),
      activityRow("after"),
      visibleComment("human"),
    ]);
    expect(plan.has("before")).toBe(false);
    expect(plan.has("after")).toBe(false);
    expect(plan.get("a")?.count).toBe(1);
  });

  it("keeps the fold id stable when a newer comment arrives", () => {
    const before = planAgentFolds([agentRow("a"), agentRow("b"), agentRow("c")]);
    const after = planAgentFolds([agentRow("a"), agentRow("b"), agentRow("c"), agentRow("d")]);
    expect(after.get("c")?.foldId).toBe(before.get("a")?.foldId);
  });

  it("treats a trailing visible comment as the newest", () => {
    const plan = planAgentFolds([agentRow("a"), visibleComment("human")]);
    expect(plan.get("a")?.count).toBe(1);
  });
});
