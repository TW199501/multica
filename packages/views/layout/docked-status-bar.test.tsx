// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useDockedLayoutStore } from "@multica/core/chat/docked-layout-store";
import { DockedStatusBar } from "./docked-status-bar";

afterEach(() => {
  useDockedLayoutStore.setState({ layoutActive: false });
});

describe("DockedStatusBar", () => {
  it("renders an empty bar while the docked layout is on screen", () => {
    useDockedLayoutStore.setState({ layoutActive: true });
    const { container } = render(<DockedStatusBar />);

    const bar = container.querySelector("[data-slot='docked-status-bar']");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("h-[30px]", "shrink-0");
    expect(bar?.textContent).toBe("");
  });

  it("renders nothing outside the docked layout", () => {
    const { container } = render(<DockedStatusBar />);

    expect(container.querySelector("[data-slot='docked-status-bar']")).toBeNull();
  });
});
