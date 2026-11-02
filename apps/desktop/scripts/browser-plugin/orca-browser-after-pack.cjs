/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS */
// electron-builder `afterPack` hook: verify the agent-browser native binary and
// the orca-browser NOTICE landed in the packaged resources directory, and mark
// the binary executable on POSIX platforms.
//
// Both files are shipped through `extraResources` in electron-builder.yml. A
// missing file would otherwise only surface at runtime when the browser MCP
// fails to start, so fail the build here instead.
const { chmodSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64" };
const NOTICE_NAME = "orca-browser-NOTICE";

function agentBrowserBinaryName(platform, arch) {
  return `agent-browser-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

function resourcesDirFor(context) {
  if (context.electronPlatformName === "darwin") {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    );
  }
  return join(context.appOutDir, "resources");
}

async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = typeof context.arch === "number" ? ARCH_NAMES[context.arch] : context.arch;
  const resourcesDir = resourcesDirFor(context);
  const binaryName = agentBrowserBinaryName(platform, arch);
  const binaryPath = join(resourcesDir, binaryName);

  for (const name of [binaryName, NOTICE_NAME]) {
    if (!existsSync(join(resourcesDir, name))) {
      throw new Error(`[orca-browser] missing ${name} in ${resourcesDir}`);
    }
  }
  if (platform !== "win32") chmodSync(binaryPath, 0o755);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.agentBrowserBinaryName = agentBrowserBinaryName;
module.exports.resourcesDirFor = resourcesDirFor;
