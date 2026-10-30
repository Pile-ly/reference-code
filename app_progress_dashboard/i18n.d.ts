// Types for i18n.js, so TypeScript callers can import it.

export const LANGUAGE_CODES: string[];
export const FALLBACK_LANGUAGE: string;
export const LANGUAGE_NAMES: Record<string, string>;
export function supportedLanguage(tag: unknown): string | undefined;
export function chooseLanguage(input: { saved?: string | null; started?: string | null; browser?: readonly string[] }): string;
export function isRightToLeft(code: string): boolean;
export function fill(template: string, values: Record<string, string | number>): string;
export function lookup(words: unknown, fallback: unknown, path: string): string | string[];
