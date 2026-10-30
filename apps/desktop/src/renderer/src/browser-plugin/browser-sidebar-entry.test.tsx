import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@multica/ui/components/ui/sidebar";

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
      <BrowserSidebarEntry />
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
