// @vitest-environment node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@multica/core/i18n";
import en from "./locales/en.json";
import zhHans from "./locales/zh-Hans.json";
import zhHant from "./locales/zh-Hant.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import fr from "./locales/fr.json";

const locales: Record<string, Record<string, string>> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ja,
  ko,
  fr,
};

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).sort();
}

describe("browser plugin locales", () => {
  it("covers every supported locale", () => {
    expect(Object.keys(locales).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("every locale has the en keys with non-empty strings", () => {
    for (const [locale, dict] of Object.entries(locales)) {
      for (const key of Object.keys(en)) {
        expect(typeof dict[key], `${locale}:${key}`).toBe("string");
        expect(dict[key]!.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("placeholders match en", () => {
    for (const [locale, dict] of Object.entries(locales)) {
      for (const [key, value] of Object.entries(en)) {
        expect(placeholders(dict[key]!), `${locale}:${key}`).toEqual(placeholders(value));
      }
    }
  });

  it("covers every key in the package key list", () => {
    const path = createRequire(import.meta.url).resolve(
      "@elf-express/orca-browser/i18n-keys.json",
    );
    const packageKeys = Object.keys(JSON.parse(readFileSync(path, "utf8")) as object);
    expect(packageKeys.length).toBeGreaterThan(0);
    for (const key of packageKeys) {
      expect(en, key).toHaveProperty([key]);
    }
  });
});
