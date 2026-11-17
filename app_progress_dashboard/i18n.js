// The page's languages: which one to open in, and filling a word-list
// string. Pure functions only, so the same file runs in the page and under
// node:test. Each language's strings are in locales/<code>.json.

/** The platform's languages, in the order the picker lists them. */
export const LANGUAGE_CODES = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'da', 'nb', 'ru', 'tr', 'th', 'ar'];
export const FALLBACK_LANGUAGE = 'en';
/** Each language by its own name, for the picker. */
export const LANGUAGE_NAMES = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  da: 'Dansk',
  nb: 'Norsk bokmål',
  ru: 'Русский',
  tr: 'Türkçe',
  th: 'ไทย',
  ar: 'العربية',
};
const RIGHT_TO_LEFT = ['ar'];

/**
 * The supported code a language tag names, or undefined. Region and script
 * subtags are dropped (`pt-BR` is `pt`, `zh-Hant-TW` is `zh`), and the
 * Norwegian tags `no` and `nn` read as `nb`.
 */
export function supportedLanguage(tag) {
  if (typeof tag !== 'string') return undefined;
  let base = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (base === 'no' || base === 'nn') base = 'nb';
  return LANGUAGE_CODES.includes(base) ? base : undefined;
}

/**
 * The language to open in: the one picked on this page before, else the
 * one the page was started with, else the first of the browser's
 * languages that is supported, else English.
 */
export function chooseLanguage({ saved, started, browser }) {
  if (saved && LANGUAGE_CODES.includes(saved)) return saved;
  if (started && LANGUAGE_CODES.includes(started)) return started;
  for (const tag of Array.isArray(browser) ? browser : []) {
    const code = supportedLanguage(tag);
    if (code) return code;
  }
  return FALLBACK_LANGUAGE;
}

export const isRightToLeft = (code) => RIGHT_TO_LEFT.includes(code);

/** `template` with each `{name}` replaced by `values[name]`; unknown names stay as written. */
export function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

/** The string at the dotted `path` in `words`, else in `fallback`, else the path itself. */
export function lookup(words, fallback, path) {
  const find = (tree) => path.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), tree);
  const found = find(words);
  if (typeof found === 'string' || Array.isArray(found)) return found;
  const backup = find(fallback);
  return typeof backup === 'string' || Array.isArray(backup) ? backup : path;
}
