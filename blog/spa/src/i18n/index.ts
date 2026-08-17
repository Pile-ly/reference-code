// i18next bootstrap (SPA standard §11) — imported once for its side effects
// from `main.tsx` before the app renders. Every user-facing string lives in
// `locales/<code>.json`; components read it through `useTranslation()`.
//
// Flow: bundle locales as synchronous static imports (no async backend, so
// the first paint is already in the right language) → detect via the
// browser LanguageDetector (localStorage, then navigator) → fall back to
// `en`. Adding a language later = one JSON file + one `resources` line —
// a content task, never a refactor.

import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    fallbackLng: "en",
    // React already escapes interpolated values, so i18next must not.
    interpolation: { escapeValue: false },
    // Resources are bundled (sync) — keep rendering synchronous, no Suspense.
    react: { useSuspense: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "blog_lang",
    },
  });

export default i18next;
