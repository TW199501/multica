import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import type { Workspace } from "@multica/core/types";
import { workspaceListOptions } from "@multica/core/workspace";

let activeUrl: string | null = null;

vi.mock("@elf-express/orca-browser/renderer", () => ({
  BrowserPane: ({ scopeId, active }: { scopeId: string; active: boolean }) => (
    <div data-testid={"pane-" + scopeId} data-active={String(active)} />
  ),
}));
vi.mock("@/stores/tab-store", () => ({
  useActiveTabUrl: () => activeUrl,
}));

import { BrowserLayer } from "./browser-layer";

function setup(slugs = ["acme", "beta"]) {
  const qc = new QueryClient();
  qc.setQueryData(
    workspaceListOptions().queryKey,
    slugs.map((slug) => ({ slug }) as Workspace),
  );
  const view = (url: string | null) => {
    activeUrl = url;
    return (
      <QueryClientProvider client={qc}>
        <BrowserLayer />
      </QueryClientProvider>
    );
  };
  return { qc, view };
}

describe("BrowserLayer", () => {
  beforeEach(() => {
    activeUrl = null;
  });

  it("mounts nothing before the browser route is visited", () => {
    const { view } = setup();
    render(view("/acme/issues"));
    expect(screen.queryByTestId(/^pane-/)).toBeNull();
  });

  it("keeps the pane mounted after leaving the browser route", () => {
    const { view } = setup();
    const { rerender } = render(view("/acme/browser"));
    const pane = screen.getByTestId("pane-acme");
    expect(pane.dataset.active).toBe("true");
    // The package overlay shares the root stacking context; an active wrapper
    // with z-index or a background would paint over the webview.
    expect(pane.parentElement!.className).not.toMatch(/(^|\s)(z-|bg-)/);

    rerender(view("/acme/issues"));
    const after = screen.getByTestId("pane-acme");
    expect(after).toBe(pane);
    expect(after.dataset.active).toBe("false");
    const wrapper = after.parentElement!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.className).toContain("invisible");
  });

  it("keeps each workspace's pane when switching workspaces", () => {
    const { view } = setup();
    const { rerender } = render(view("/acme/browser"));
    const acme = screen.getByTestId("pane-acme");

    rerender(view("/beta/browser"));
    expect(screen.getByTestId("pane-acme").dataset.active).toBe("false");
    expect(screen.getByTestId("pane-beta").dataset.active).toBe("true");

    rerender(view("/acme/browser"));
    expect(screen.getByTestId("pane-acme")).toBe(acme);
    expect(acme.dataset.active).toBe("true");
  });

  describe("in the docked chat layout", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe() {}
          disconnect() {}
        },
      );
    });
    afterEach(() => {
      useDockedLayoutStore.setState({ pageElement: null });
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("covers only the docked page column", () => {
      const rect = (left: number, top: number, width: number, height: number) =>
        ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON() {} }) as DOMRect;
      const page = document.createElement("div");
      vi.spyOn(page, "getBoundingClientRect").mockReturnValue(rect(300, 50, 800, 600));
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this === page ? rect(300, 50, 800, 600) : rect(100, 40, 1400, 700);
      });
      useDockedLayoutStore.setState({ pageElement: page });

      const { view } = setup();
      render(view("/acme/browser"));

      const panes = screen.getByTestId("pane-acme").parentElement!.parentElement!;
      expect(panes.style.left).toBe("200px");
      expect(panes.style.top).toBe("10px");
      expect(panes.style.width).toBe("800px");
      expect(panes.style.height).toBe("600px");
      expect(panes.closest("[data-browser-frame]")!.className).toContain("pointer-events-none");
    });
  });

  it("drops panes of deleted workspaces", () => {
    const { qc, view } = setup();
    const { rerender } = render(view("/acme/browser"));
    expect(screen.getByTestId("pane-acme")).toBeTruthy();

    qc.setQueryData(workspaceListOptions().queryKey, [{ slug: "beta" } as Workspace]);
    rerender(view("/beta/issues"));
    expect(screen.queryByTestId("pane-acme")).toBeNull();
  });
});
