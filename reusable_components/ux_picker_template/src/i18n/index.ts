// i18next bootstrap (SPA standard §11) — imported once for its side effects
// from `main.tsx` before the app renders. Every user-facing string lives in
// `locales/<code>.json`; components read it through `useTranslation()`.
//
// Flow: bundle every locale as a synchronous static import (no async
// backend, so the first paint is already in the right language) → detect via
// `?lng=`, then localStorage, then the browser → fall back to `en`. A
// regional code collapses to its base (`en-US` → `en`).
//
// The picker ships the same languages as the pilely.app SPA, so a user meets
// it in the language they already use the platform in. Detection stops at
// localStorage rather than a cookie: this file is often opened straight from
// disk, where there is no host to scope a cookie to.
//
// Shipping a new language: add `locales/<code>.json`, a row in
// `languages.ts`, and its import + `resources` entry below.
// `locales.test.ts` guards parity.

import LanguageDetector from "i18next-browser-languagedetector";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { SUPPORTED_LANGUAGE_CODES } from "./languages";

import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import ru from "./locales/ru.json";
import tr from "./locales/tr.json";
import ar from "./locales/ar.json";
import ko from "./locales/ko.json";
import de from "./locales/de.json";
import da from "./locales/da.json";
import nb from "./locales/nb.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import nl from "./locales/nl.json";
import th from "./locales/th.json";

// Keyed by the same codes as `SUPPORTED_LANGUAGES` (a missing or mistyped
// entry trips the `locales.test.ts` parity check).
const resources = {
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },
  es: { translation: es },
  pt: { translation: pt },
  ru: { translation: ru },
  tr: { translation: tr },
  ar: { translation: ar },
  ko: { translation: ko },
  de: { translation: de },
  da: { translation: da },
  nb: { translation: nb },
  fr: { translation: fr },
  it: { translation: it },
  nl: { translation: nl },
  th: { translation: th },
};

// Mirror the active language onto <html> so the browser applies the right
// text direction (RTL for Arabic) and `lang` for accessibility.
function applyHtmlLang(): void {
  const root = document.documentElement;
  root.setAttribute("lang", i18n.resolvedLanguage ?? i18n.language ?? "en");
  root.setAttribute("dir", i18n.dir());
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    fallbackLng: "en",
    // React already escapes interpolated values, so i18next must not.
    interpolation: { escapeValue: false },
    // Resources are bundled (sync) — keep rendering synchronous, no Suspense.
    react: { useSuspense: false },
    detection: {
      order: ["querystring", "localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupQuerystring: "lng",
      lookupLocalStorage: "ux_picker_lang",
    },
  });

applyHtmlLang();
i18n.on("languageChanged", applyHtmlLang);

export default i18n;
