// @vitest-environment node
import { describe, expect, it } from "vitest";
import { browserPath, browserScopeForUrl } from "./browser-scope";

describe("browserScopeForUrl", () => {
  it("returns the workspace slug on the browser route", () => {
    expect(browserScopeForUrl("/acme/browser")).toBe("acme");
  });

  it("ignores the query string and hash", () => {
    expect(browserScopeForUrl("/acme/browser?x=1#h")).toBe("acme");
  });

  it("returns null on other routes", () => {
    expect(browserScopeForUrl("/acme/issues")).toBeNull();
    expect(browserScopeForUrl("/acme/browser/extra")).toBeNull();
  });

  it("returns null without a url", () => {
    expect(browserScopeForUrl(null)).toBeNull();
  });
});

describe("browserPath", () => {
  it("builds the browser route path for a slug", () => {
    expect(browserPath("acme")).toBe("/acme/browser");
  });
});
