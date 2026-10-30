// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import {
  createBrowserHost,
  resolveBrowserResourcesPath,
  resolveDevAgentBrowserBinDir,
  type BrowserHostDeps,
} from "./browser-plugin-host";

function makeDeps(overrides: Partial<BrowserHostDeps> = {}): BrowserHostDeps {
  return {
    getMainWindow: () => null,
    userDataDir: "/user-data",
    isPackaged: false,
    processResourcesPath: "/app/resources",
    devAgentBrowserBinDir: "/dev/bin",
    openExternal: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveBrowserResourcesPath", () => {
  it("uses process.resourcesPath when packaged", () => {
    expect(
      resolveBrowserResourcesPath({
        isPackaged: true,
        processResourcesPath: "/app/resources",
        devAgentBrowserBinDir: "/dev/bin",
      }),
    ).toBe("/app/resources");
  });

  it("uses the agent-browser bin dir in development", () => {
    expect(
      resolveBrowserResourcesPath({
        isPackaged: false,
        processResourcesPath: "/app/resources",
        devAgentBrowserBinDir: "/dev/bin",
      }),
    ).toBe("/dev/bin");
  });
});

describe("resolveDevAgentBrowserBinDir", () => {
  it("resolves the dev agent-browser bin dir", () => {
    const dir = resolveDevAgentBrowserBinDir();
    expect(dir).toMatch(/agent-browser[\\/]bin$/);
    expect(existsSync(join(dir, "agent-browser.js"))).toBe(true);
  });
});

describe("createBrowserHost", () => {
  it("openExternal always returns a promise", async () => {
    const openExternal = vi.fn().mockReturnValue(undefined);
    const host = createBrowserHost(makeDeps({ openExternal }));

    const pending = host.openExternal("https://a.test");
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBeUndefined();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://a.test");
  });

  it("prefixes log lines", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const host = createBrowserHost(makeDeps());

    host.logger.warn("x", { a: 1 });
    host.logger.info("y");

    expect(warn).toHaveBeenCalledWith("[orca-browser] x", { a: 1 });
    expect(info).toHaveBeenCalledWith("[orca-browser] y");
  });

  it("reads the latest main window on every call", () => {
    let current: BrowserWindow | null = null;
    const host = createBrowserHost(makeDeps({ getMainWindow: () => current }));
    expect(host.getMainWindow()).toBeNull();

    const next = { id: 7 } as unknown as BrowserWindow;
    current = next;
    expect(host.getMainWindow()).toBe(next);
  });
});
