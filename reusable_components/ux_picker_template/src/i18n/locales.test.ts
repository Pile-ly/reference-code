// Parity guard for the locale bundles. Every language declared in
// `languages.ts` must ship a `locales/<code>.json` whose key paths EXACTLY
// match the English source — no missing key (which would surface a raw key
// or the English fallback at runtime) and no stray extra key. This is what
// lets "add a row in languages.ts + drop a JSON file" be the whole job of a
// new language, and it catches a translator dropping, renaming or inventing
// a key.

import { describe, expect, it } from "vitest";

import { SUPPORTED_LANGUAGE_CODES } from "./languages";
import en from "./locales/en.json";

// Eagerly load every bundled locale JSON, keyed by its base filename.
const localeModules = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*.json",
  { eager: true },
);

const byCode = new Map<string, Record<string, unknown>>();
for (const [filePath, mod] of Object.entries(localeModules)) {
  byCode.set(filePath.replace(/^.*\/(.+)\.json$/, "$1"), mod.default);
}

// Flatten a nested translation object into a sorted list of dotted key paths
// so two locales can be compared key-for-key regardless of declaration order.
function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

const enKeys = keyPaths(en as Record<string, unknown>);

describe("locale parity with en.json", () => {
  it("ships every declared language as a bundled JSON file", () => {
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(byCode.has(code), `no locales/${code}.json for declared language`).toBe(true);
    }
  });

  it("declares every bundled JSON file as a language", () => {
    for (const code of byCode.keys()) {
      expect(SUPPORTED_LANGUAGE_CODES, `locales/${code}.json is not in languages.ts`).toContain(code);
    }
  });

  it.each(SUPPORTED_LANGUAGE_CODES.filter((c) => c !== "en"))(
    "%s.json has exactly the English key set",
    (code) => {
      const locale = byCode.get(code);
      expect(locale, `no locales/${code}.json`).toBeDefined();
      expect(keyPaths(locale!)).toEqual(enKeys);
    },
  );

  it.each(SUPPORTED_LANGUAGE_CODES)("%s.json leaves no string empty", (code) => {
    const walk = (obj: Record<string, unknown>, prefix = ""): void => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object") walk(v as Record<string, unknown>, path);
        else expect(String(v).trim(), `${code}.json: ${path} is empty`).not.toBe("");
      }
    };
    walk(byCode.get(code)!);
  });
});
