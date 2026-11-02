// @vitest-environment node
import { createRequire } from "node:module";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dirname, "..", "..");
const afterPack = require("./orca-browser-after-pack.cjs");
const { agentBrowserBinaryName, resourcesDirFor } = afterPack;

const dirs = [];
function fakeContext(electronPlatformName, arch) {
  const appOutDir = mkdtempSync(join(tmpdir(), "orca-browser-after-pack-"));
  dirs.push(appOutDir);
  return {
    electronPlatformName,
    arch,
    appOutDir,
    packager: { appInfo: { productFilename: "Multica" } },
  };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("orca-browser afterPack hook", () => {
  it("names the Windows binary with .exe", () => {
    expect(agentBrowserBinaryName("win32", "arm64")).toBe("agent-browser-win32-arm64.exe");
    expect(agentBrowserBinaryName("linux", "x64")).toBe("agent-browser-linux-x64");
    expect(agentBrowserBinaryName("darwin", "arm64")).toBe("agent-browser-darwin-arm64");
  });

  it("resolves the macOS Resources dir", () => {
    const mac = fakeContext("darwin", 3);
    expect(resourcesDirFor(mac)).toBe(
      join(mac.appOutDir, "Multica.app", "Contents", "Resources"),
    );
    const linux = fakeContext("linux", 1);
    expect(resourcesDirFor(linux)).toBe(join(linux.appOutDir, "resources"));
  });

  it.skipIf(process.platform === "win32")("chmods the linux binary to 0755", async () => {
    const ctx = fakeContext("linux", 1);
    const res = resourcesDirFor(ctx);
    mkdirSync(res, { recursive: true });
    const bin = join(res, "agent-browser-linux-x64");
    writeFileSync(bin, "bin");
    writeFileSync(join(res, "orca-browser-NOTICE"), "notice");
    chmodSync(bin, 0o644);
    chmodSync(join(res, "orca-browser-NOTICE"), 0o644);

    await afterPack(ctx);

    expect(statSync(bin).mode & 0o777).toBe(0o755);
  });

  it("fails packaging when the binary is missing", async () => {
    const ctx = fakeContext("linux", 1);
    const res = resourcesDirFor(ctx);
    mkdirSync(res, { recursive: true });
    writeFileSync(join(res, "orca-browser-NOTICE"), "notice");

    await expect(afterPack(ctx)).rejects.toThrow("agent-browser-linux-x64");
  });

  it("fails packaging when the NOTICE is missing", async () => {
    const ctx = fakeContext("linux", 1);
    const res = resourcesDirFor(ctx);
    mkdirSync(res, { recursive: true });
    writeFileSync(join(res, "agent-browser-linux-x64"), "bin");

    await expect(afterPack(ctx)).rejects.toThrow("orca-browser-NOTICE");
  });

  it("pins agent-browser to the orca-browser package's version", () => {
    const desktop = JSON.parse(readFileSync(resolve(desktopRoot, "package.json"), "utf8"));
    const pkg = JSON.parse(
      readFileSync(
        resolve(desktopRoot, "node_modules/@elf-express/orca-browser/package.json"),
        "utf8",
      ),
    );
    expect(desktop.dependencies["agent-browser"]).toBe(pkg.dependencies["agent-browser"]);
  });
});
