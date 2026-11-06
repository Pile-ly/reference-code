// The platform's supported languages, by the code an agent passes as
// `--lang`: a bare lowercase ISO 639-1 base subtag, in the order
// https://pam.pilely.app/locale_list shows them. Only `ar` is laid out
// right to left.

export const LANGUAGE_CODES = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'da', 'nb', 'ru', 'tr', 'th', 'ar'] as const;

/** The supported code `value` names (any case, surrounding space ignored), or undefined. */
export function supportedLanguage(value: string): string | undefined {
  const code = value.trim().toLowerCase();
  return (LANGUAGE_CODES as readonly string[]).includes(code) ? code : undefined;
}
