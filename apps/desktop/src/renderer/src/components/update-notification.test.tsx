import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateNotification } from "./update-notification";

const mocks = vi.hoisted(() => ({
  installUpdate: vi.fn(),
  openExternal: vi.fn(),
}));

type UpdateDownloadedListener = (info: {
  version: string;
  releaseNotes?: string;
}) => void;

describe("UpdateNotification", () => {
  let updateDownloaded: UpdateDownloadedListener;

  beforeEach(() => {
    mocks.installUpdate.mockReset().mockResolvedValue(undefined);
    mocks.openExternal.mockReset().mockResolvedValue(undefined);

    Object.defineProperty(window, "desktopAPI", {
      configurable: true,
      value: { openExternal: mocks.openExternal },
    });
    Object.defineProperty(window, "updater", {
      configurable: true,
      value: {
        onUpdateDownloaded: (listener: UpdateDownloadedListener) => {
          updateDownloaded = listener;
          return vi.fn();
        },
        installUpdate: mocks.installUpdate,
      },
    });
  });

  it("opens the downloaded version's changelog from the update prompt", () => {
    render(<UpdateNotification />);
    act(() => updateDownloaded({ version: "0.4.27" }));

    expect(screen.queryByRole("button", { name: "Later" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See changelog" }));

    expect(mocks.openExternal).toHaveBeenCalledWith(
      "https://multica.ai/changelog#release-0-4-27",
    );
  });

  it("opens the fork's release page when the build targets a fork", () => {
    vi.stubEnv("VITE_RELEASE_REPOSITORY", "TW199501/multica");
    try {
      render(<UpdateNotification />);
      act(() => updateDownloaded({ version: "0.7.0-tw.3" }));
      fireEvent.click(screen.getByRole("button", { name: "See changelog" }));

      expect(mocks.openExternal).toHaveBeenCalledWith(
        "https://github.com/TW199501/multica/releases/tag/v0.7.0-tw.3",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still installs the update immediately from the primary action", () => {
    render(<UpdateNotification />);
    act(() => updateDownloaded({ version: "0.4.27" }));

    fireEvent.click(screen.getByRole("button", { name: "Restart now" }));

    expect(mocks.installUpdate).toHaveBeenCalledOnce();
  });
});
