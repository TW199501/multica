import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("BrowserSidebarEntry", () => {
  beforeEach(() => {
    slug = "acme";
    activeUrl = null;
  });

  it("links to the browser route", () => {
    render(<BrowserSidebarEntry />);
    const link = screen.getByRole("link", { name: "Browser" });
    expect(link.getAttribute("href")).toBe("/acme/browser");
    expect(link.hasAttribute("aria-current")).toBe(false);
  });

  it("marks itself current on the browser route", () => {
    activeUrl = "/acme/browser";
    render(<BrowserSidebarEntry />);
    expect(screen.getByRole("link", { name: "Browser" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders nothing without a workspace", () => {
    slug = null;
    const { container } = render(<BrowserSidebarEntry />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
