import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCmdWCloseTab } from "./App";
import { useTabStore } from "./stores/tab-store";

let trigger: () => void;
const closeWindow = vi.fn();

function tabCount() {
  const { activeWorkspaceSlug, byWorkspace } = useTabStore.getState();
  return activeWorkspaceSlug ? byWorkspace[activeWorkspaceSlug]?.tabs.length : 0;
}

beforeEach(() => {
  closeWindow.mockReset();
  useTabStore.getState().reset();
  Object.defineProperty(window, "desktopAPI", {
    configurable: true,
    writable: true,
    value: {
      closeWindow,
      windowContext: { kind: "main" },
      onCloseActiveTab: (cb: () => void) => {
        trigger = cb;
        return () => {};
      },
    },
  });
});

describe("useCmdWCloseTab", () => {
  it("keeps the window open when the last tab gets Ctrl+W", () => {
    useTabStore.getState().switchWorkspace("acme", "/acme/issues");
    expect(tabCount()).toBe(1);
    renderHook(() => useCmdWCloseTab());
    trigger();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(tabCount()).toBe(1);
  });

  it("closes the active tab when several are open", () => {
    useTabStore.getState().switchWorkspace("acme", "/acme/issues");
    useTabStore.getState().addTab("/acme/projects", "Projects");
    expect(tabCount()).toBe(2);
    renderHook(() => useCmdWCloseTab());
    trigger();
    expect(tabCount()).toBe(1);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("still closes an issue window", () => {
    window.desktopAPI.windowContext = {
      issueId: "MUL-1",
      kind: "issue",
      path: "/acme/issues/MUL-1",
    } as never;
    renderHook(() => useCmdWCloseTab());
    trigger();
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it("still closes the window with no workspace", () => {
    expect(useTabStore.getState().activeWorkspaceSlug).toBeNull();
    renderHook(() => useCmdWCloseTab());
    trigger();
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});
