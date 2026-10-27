// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_RELEASE_REPOSITORY } from "@multica/core/config";
import { UPSTREAM_DOCS_URL, resolveDocsUrl } from "./docs-url";

describe("resolveDocsUrl", () => {
  it("uses upstream docs for deployments on upstream releases", () => {
    expect(
      resolveDocsUrl({
        releaseRepository: DEFAULT_RELEASE_REPOSITORY,
        daemonAppUrl: "http://192.168.25.100:13300",
      }),
    ).toBe(UPSTREAM_DOCS_URL);
  });

  it("uses upstream docs when the server reports no app URL", () => {
    expect(
      resolveDocsUrl({ releaseRepository: "TW199501/multica", daemonAppUrl: "" }),
    ).toBe(UPSTREAM_DOCS_URL);
  });

  it("uses the deployment's own docs when it ships its own builds", () => {
    expect(
      resolveDocsUrl({
        releaseRepository: "TW199501/multica",
        daemonAppUrl: "http://192.168.25.100:13300/",
      }),
    ).toBe("http://192.168.25.100:13300/docs");
  });
});
