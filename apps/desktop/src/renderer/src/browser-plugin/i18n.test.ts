// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@multica/core/i18n";
import {
  createBrowserT,
  resolveBrowserLocale,
  type BrowserDictionaries,
} from "./i18n";

function dictionaries(
  overrides: Partial<Record<SupportedLocale, Record<string, string>>>,
): BrowserDictionaries {
  const result = {} as BrowserDictionaries;
  for (const locale of SUPPORTED_LOCALES) result[locale] = overrides[locale] ?? {};
  return result;
}

describe("browser plugin i18n", () => {
  it("returns the sidebar label in every locale", () => {
    const expected: Record<SupportedLocale, string> = {
      en: "Browser",
      "zh-Hans": "浏览器",
      "zh-Hant": "瀏覽器",
      ja: "ブラウザ",
      ko: "브라우저",
      fr: "Navigateur",
    };
    for (const locale of SUPPORTED_LOCALES) {
      expect(createBrowserT(locale)("multica.browser.sidebar.label", "Browser")).toBe(
        expected[locale],
      );
    }
  });

  it("falls back to English, then to the fallback", () => {
    const dicts = dictionaries({ en: { a: "A" }, ja: {} });
    const t = createBrowserT("ja", dicts);
    expect(t("a", "x")).toBe("A");
    expect(t("zz", "x")).toBe("x");
  });

  it("interpolates vars", () => {
    const t = createBrowserT("en", dictionaries({ en: { k: "{{value0}} of {{value1}}" } }));
    expect(t("k", "", { value0: 1, value1: 3 })).toBe("1 of 3");
    expect(t("k", "", { value0: 1 })).toBe("1 of {{value1}}");
  });

  it("resolves supported locales only", () => {
    expect(resolveBrowserLocale("zh-Hant")).toBe("zh-Hant");
    expect(resolveBrowserLocale("de")).toBe("en");
    expect(resolveBrowserLocale(undefined)).toBe("en");
  });
});
