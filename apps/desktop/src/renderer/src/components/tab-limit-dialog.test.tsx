import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@multica/core/i18n/react";
import { RESOURCES } from "@multica/views/locales";
import { TAB_LIMIT, getActiveTab, useTabStore } from "@/stores/tab-store";

vi.mock("@multica/views/layout", () => ({
  useTabPresentation: (_url: string, fallbackTitle?: string) => ({
    visual: { kind: "icon", icon: "ListTodo" },
    title: fallbackTitle ?? "",
  }),
}));

import { TabLimitDialog } from "./tab-limit-dialog";

const tabs = () => useTabStore.getState().byWorkspace.acme.tabs;

function fillToLimitAndAskForAnother() {
  const store = useTabStore.getState();
  store.switchWorkspace("acme");
  for (let i = 1; i < TAB_LIMIT; i++) {
    store.addTab(`/acme/issues/i${i}`, `Issue ${i}`);
  }
  store.addTab("/acme/projects", "Projects");
}

function renderDialog() {
  return render(
    <I18nProvider locale="en" resources={RESOURCES}>
      <TabLimitDialog />
    </I18nProvider>,
  );
}

beforeEach(() => {
  useTabStore.getState().reset();
});

describe("TabLimitDialog", () => {
  it("stays closed without a pending tab open", () => {
    useTabStore.getState().switchWorkspace("acme");
    renderDialog();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("names the leftmost unpinned tab it will close", () => {
    fillToLimitAndAskForAnother();
    useTabStore.getState().togglePin(tabs()[0].id);
    renderDialog();

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(`${TAB_LIMIT} tabs open`)).toBeTruthy();
    expect(
      screen.getByText("Close “Issue 1”, the leftmost tab, to open a new one?"),
    ).toBeTruthy();
  });

  it("takes the tab count in its title from TAB_LIMIT", () => {
    type Settings = { desktop: { tab_bar: { limit_title: string } } };
    for (const bundle of Object.values(RESOURCES)) {
      const settings = (bundle as { settings: Settings }).settings;
      expect(settings.desktop.tab_bar.limit_title).toContain("{{count}}");
    }
  });

  it("closes the leftmost tab and activates the new one on confirm", async () => {
    fillToLimitAndAskForAnother();
    const leftmost = tabs()[0].id;
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Close and open" }));

    const s = useTabStore.getState();
    expect(s.pendingTabOpen).toBeNull();
    expect(tabs().map((t) => t.id)).not.toContain(leftmost);
    expect(getActiveTab(s)?.url).toBe("/acme/projects");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("cancels without touching the tabs", async () => {
    fillToLimitAndAskForAnother();
    const before = tabs();
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useTabStore.getState().pendingTabOpen).toBeNull();
    expect(tabs()).toBe(before);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("treats Escape as cancel", async () => {
    fillToLimitAndAskForAnother();
    const before = tabs();
    renderDialog();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    await waitFor(() =>
      expect(useTabStore.getState().pendingTabOpen).toBeNull(),
    );
    expect(tabs()).toBe(before);
  });
});
