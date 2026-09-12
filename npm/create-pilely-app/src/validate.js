// Shared value validation, used identically by argv parsing (src/cli.js)
// and the interactive prompt sequence (src/prompt.js) -- one rule, not two
// copies: an invalid value is always rejected, never silently coerced.

import { SERVICE_NAMES } from "./schema.js";

function parseServicesCsv(raw) {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    return { ok: false, message: "must not be empty" };
  }
  if (items.includes("none")) {
    if (items.length !== 1) {
      return { ok: false, message: 'the literal "none" cannot be combined with service names' };
    }
    return { ok: true, value: [] };
  }
  const invalid = items.filter((i) => !SERVICE_NAMES.includes(i));
  if (invalid.length > 0) {
    return { ok: false, message: `unknown service(s): ${invalid.join(", ")}` };
  }
  return { ok: true, value: items };
}

/**
 * Validates a raw (already-parsed-from-argv-or-typed-at-a-prompt) value
 * against one schema descriptor.
 * @returns {{ok: true, value: *} | {ok: false, message: string}}
 */
export function validateOptionValue(opt, raw) {
  if (opt.type === "enum-csv") {
    return parseServicesCsv(raw);
  }
  // "string" (and the positional, which is also type "string"): any value
  // is syntactically valid here -- refusing a non-empty target directory is
  // a separate, filesystem-level check the CLI wiring runs on its own.
  return { ok: true, value: raw };
}
