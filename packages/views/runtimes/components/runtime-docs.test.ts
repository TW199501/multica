// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  customRuntimeDocsHref,
  daemonRuntimesDocsHref,
} from "./runtime-docs";
import { UPSTREAM_DOCS_URL } from "../../common/docs-url";

describe("runtime docs links", () => {
  it.each([
    ["en", "https://multica.ai/docs/daemon-runtimes"],
    ["zh-Hans", "https://multica.ai/docs/zh/daemon-runtimes"],
    ["ja", "https://multica.ai/docs/ja/daemon-runtimes"],
    ["ko", "https://multica.ai/docs/ko/daemon-runtimes"],
    ["fr", "https://multica.ai/docs/fr/daemon-runtimes"],
  ])("localizes the daemon guide for %s", (language, expected) => {
    expect(daemonRuntimesDocsHref(UPSTREAM_DOCS_URL, language)).toBe(expected);
  });

  it("adds the localized custom runtime section", () => {
    expect(customRuntimeDocsHref(UPSTREAM_DOCS_URL, "zh-Hans")).toBe(
      `https://multica.ai/docs/zh/daemon-runtimes#${encodeURIComponent("自定义运行时配置")}`,
    );
    expect(customRuntimeDocsHref(UPSTREAM_DOCS_URL, "fr")).toBe(
      `https://multica.ai/docs/fr/daemon-runtimes#${encodeURIComponent("profils-de-runtime-personnalisés")}`,
    );
  });
});
