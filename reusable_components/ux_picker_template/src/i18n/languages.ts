// Single source of truth for the languages this picker ships — the same set
// as the pilely.app SPA, so a user meets the picker in the language they
// already use the platform in. Both the i18n bootstrap (`supportedLngs` +
// `resources` in `index.ts`) and `locales.test.ts` read from this list.
//
// `code`       — standard i18next/BCP-47 language code; matches the filename.
// `nativeName` — the endonym, always in its own script.

export type SupportedLanguage = {
  code: string;
  nativeName: string;
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", nativeName: "English" },
  { code: "zh", nativeName: "简体中文" },
  { code: "ja", nativeName: "日本語" },
  { code: "es", nativeName: "Español" },
  { code: "pt", nativeName: "Português" },
  { code: "ru", nativeName: "Русский" },
  { code: "tr", nativeName: "Türkçe" },
  { code: "ar", nativeName: "العربية" },
  { code: "ko", nativeName: "한국어" },
  { code: "de", nativeName: "Deutsch" },
  { code: "da", nativeName: "Dansk" },
  { code: "nb", nativeName: "Norsk bokmål" },
  { code: "fr", nativeName: "Français" },
  { code: "it", nativeName: "Italiano" },
  { code: "nl", nativeName: "Nederlands" },
  { code: "th", nativeName: "ไทย" },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);
