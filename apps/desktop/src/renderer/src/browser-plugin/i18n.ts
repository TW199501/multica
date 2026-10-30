import { useMemo } from "react";
import type { BrowserRendererHost } from "@elf-express/orca-browser/renderer";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@multica/core/i18n";
import { useLocale } from "@multica/views/i18n";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zhHans from "./locales/zh-Hans.json";
import zhHant from "./locales/zh-Hant.json";

export type BrowserT = BrowserRendererHost["t"];
export type BrowserDictionaries = Record<SupportedLocale, Record<string, string>>;

export const BROWSER_LOCALES: BrowserDictionaries = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ja,
  ko,
  fr,
};

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

// `useLocale()` returns a plain string; anything outside the supported set uses English.
export function resolveBrowserLocale(language: string | undefined): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(language ?? "")
    ? (language as SupportedLocale)
    : "en";
}

// Lookup order: current locale, English, then the fallback the package passes in.
// Placeholders without a matching var stay as written.
export function createBrowserT(
  locale: SupportedLocale,
  dictionaries: BrowserDictionaries = BROWSER_LOCALES,
): BrowserT {
  return (key, fallback, vars) => {
    const template = dictionaries[locale]?.[key] ?? dictionaries.en?.[key] ?? fallback;
    if (!vars) return template;
    return template.replace(PLACEHOLDER, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  };
}

export function useBrowserT(): BrowserT {
  const locale = resolveBrowserLocale(useLocale());
  return useMemo(() => createBrowserT(locale), [locale]);
}
