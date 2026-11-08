// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { I18nProvider } from "@multica/core/i18n/react";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import enLayout from "../locales/en/layout.json";

vi.mock("@multica/core/paths", () => ({
  useWorkspacePaths: () => ({ settings: () => "/acme/settings", projects: () => "/acme/projects" }),
}));

vi.mock("../projects/components/project-code-explorer", () => ({
  ProjectCodeExplorer: ({ projectId }: { projectId: string }) => (
    <div data-testid="code-explorer">{projectId}</div>
  ),
}));

const { DockedSidebarTabs, dockedSectionBody, useDockedSidebarSection } = await import(
  "./docked-sidebar-sections"
);

function Sections() {
  const active = useDockedSidebarSection();
  return (
    <>
      <DockedSidebarTabs active={active} />
      {active === "menu" ? <div data-testid="menu" /> : dockedSectionBody(active)}
    </>
  );
}

function navigationAt(pathname: string, push = vi.fn()): NavigationAdapter {
  return {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname,
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
}

function renderAt(pathname: string) {
  const push = vi.fn();
  const navigation = navigationAt(pathname, push);
  render(
    <I18nProvider locale="en" resources={{ en: { layout: enLayout } }}>
      <NavigationProvider value={navigation}>
        <Sections />
      </NavigationProvider>
    </I18nProvider>,
  );
  return { push };
}

beforeEach(() => {
  useDockedLayoutStore.setState({ sidebarSection: "menu", settingsNavTarget: null });
});

describe("docked sidebar sections", () => {
  it("lists menu, projects and settings in that order and starts on the menu", () => {
    renderAt("/acme/issues");

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Menu",
      "Projects",
      "Settings",
    ]);
    expect(screen.getByRole("tab", { name: "Menu" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("menu")).toBeInTheDocument();
  });

  it("shows the project tree placeholder until a repository is connected", () => {
    renderAt("/acme/issues");

    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));

    expect(screen.getByRole("region", { name: "Pinned" })).toHaveTextContent("Nothing pinned yet.");
    expect(screen.getByRole("region", { name: "File explorer" })).toHaveTextContent(
      "Open a project to see its files.",
    );
    expect(screen.queryByTestId("menu")).not.toBeInTheDocument();
  });

  it("shows pinned items above the file explorer", () => {
    render(
      <I18nProvider locale="en" resources={{ en: { layout: enLayout } }}>
        <NavigationProvider value={navigationAt("/acme/issues")}>
          {dockedSectionBody("projects", { pinned: <a href="/acme/projects/p1">Roadmap</a> })}
        </NavigationProvider>
      </I18nProvider>,
    );

    const pinned = screen.getByRole("region", { name: "Pinned" });
    const explorer = screen.getByRole("region", { name: "File explorer" });
    expect(pinned).toHaveTextContent("Roadmap");
    expect(pinned.compareDocumentPosition(explorer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the open project's files in the explorer", () => {
    render(
      <I18nProvider locale="en" resources={{ en: { layout: enLayout } }}>
        <NavigationProvider value={navigationAt("/acme/projects/p1")}>{dockedSectionBody("projects")}</NavigationProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId("code-explorer")).toHaveTextContent("p1");
  });

  it("opens Settings from its tab and hosts the settings navigation there", () => {
    const { push } = renderAt("/acme/issues");

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    expect(push).toHaveBeenCalledWith("/acme/settings");
  });

  it("selects the settings section on the settings route and gives the page a host", () => {
    renderAt("/acme/settings");

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    expect(useDockedLayoutStore.getState().settingsNavTarget).toBeInstanceOf(HTMLElement);
  });

  it("lets the menu and projects tabs open while on the settings route", () => {
    const { push } = renderAt("/acme/settings");

    fireEvent.click(screen.getByRole("tab", { name: "Menu" }));
    expect(screen.getByRole("tab", { name: "Menu" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("menu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(screen.getByText("Open a project to see its files.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    expect(push).not.toHaveBeenCalled();
  });
});
