import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarMenu, SidebarProvider } from "@multica/ui/components/ui/sidebar";
import { NAV_ITEM_CLASS_NAME } from "@multica/views/layout";

let slug: string | null = "acme";
let activeUrl: string | null = null;

vi.mock("@multica/core/paths", () => ({
  useWorkspaceSlug: () => slug,
}));
vi.mock("@multica/views/navigation", () => ({
  AppLink: ({ href, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest} />
  ),
}));
vi.mock("@/stores/tab-store", () => ({
  useActiveTabUrl: () => activeUrl,
}));

import { BrowserSidebarEntry } from "./browser-sidebar-entry";

function renderEntry() {
  return render(
    <SidebarProvider>
      <SidebarMenu>
        <BrowserSidebarEntry />
      </SidebarMenu>
    </SidebarProvider>,
  );
}

describe("BrowserSidebarEntry", () => {
  beforeEach(() => {
    slug = "acme";
    activeUrl = null;
  });

  it("links to the browser route", () => {
    renderEntry();
    const link = screen.getByRole("link", { name: "Browser" });
    expect(link.getAttribute("href")).toBe("/acme/browser");
    expect(link.hasAttribute("data-active")).toBe(false);
  });

  it("uses the shared nav item styling at the default size", () => {
    renderEntry();
    const link = screen.getByRole("link", { name: "Browser" });
    for (const cls of NAV_ITEM_CLASS_NAME.split(" ")) {
      expect(link.className).toContain(cls);
    }
    expect(link.getAttribute("data-size")).toBe("default");
  });

  it("marks itself active on the browser route", () => {
    activeUrl = "/acme/browser";
    renderEntry();
    // The sidebar primitive renders `data-active` as a bare presence attribute.
    expect(screen.getByRole("link", { name: "Browser" }).hasAttribute("data-active")).toBe(true);
  });

  it("renders nothing without a workspace", () => {
    slug = null;
    const { container } = renderEntry();
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
