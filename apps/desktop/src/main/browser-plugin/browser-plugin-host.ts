import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { BrowserWindow } from "electron";
import type { BrowserHost, BrowserHostLogger } from "@elf-express/orca-browser/shared";

const LOG_PREFIX = "[orca-browser]";

export interface BrowserHostDeps {
  getMainWindow(): BrowserWindow | null;
  userDataDir: string;
  isPackaged: boolean;
  processResourcesPath: string;
  devAgentBrowserBinDir: string;
  openExternal(url: string): Promise<void> | void;
}

// Packaged builds ship agent-browser's native binaries under
// process.resourcesPath; in development they live in the package's bin dir.
export function resolveBrowserResourcesPath(
  deps: Pick<
    BrowserHostDeps,
    "isPackaged" | "processResourcesPath" | "devAgentBrowserBinDir"
  >,
): string {
  return deps.isPackaged ? deps.processResourcesPath : deps.devAgentBrowserBinDir;
}

export function resolveDevAgentBrowserBinDir(): string {
  return join(
    dirname(createRequire(__filename).resolve("agent-browser/package.json")),
    "bin",
  );
}

function logWith(
  method: "debug" | "info" | "warn" | "error",
): BrowserHostLogger["debug"] {
  return (message, ...args) => {
    console[method](`${LOG_PREFIX} ${message}`, ...args);
  };
}

const logger: BrowserHostLogger = {
  debug: logWith("debug"),
  info: logWith("info"),
  warn: logWith("warn"),
  error: logWith("error"),
};

export function createBrowserHost(deps: BrowserHostDeps): BrowserHost {
  return {
    getMainWindow: deps.getMainWindow,
    userDataDir: deps.userDataDir,
    resourcesPath: resolveBrowserResourcesPath(deps),
    logger,
    openExternal: async (url) => {
      await deps.openExternal(url);
    },
  };
}
