// --help / --help --json rendering. Both read OPTION_SCHEMA and nothing
// else -- an option added to the schema shows up here automatically, no
// second edit.

import { OPTION_SCHEMA } from "./schema.js";

// The exact one-shot example from the task's own "## Proof" section, quoted
// character-for-character so --help, the README, and the task's proof all
// agree.
export const ONE_SHOT_EXAMPLE =
  "create-pilely-app my-app --services simple-db,simple-blob --sign-in --no-install --json";

function describeFlags(opt) {
  return opt.positional ? "<project-directory>" : opt.flags.join(" | ");
}

function describeType(opt) {
  if (opt.type === "boolean") return "boolean";
  if (opt.type === "enum-csv") return `csv of: ${opt.choices.join(", ")}`;
  return "string";
}

function describeRequirement(opt) {
  return opt.required ? "required" : `default: ${JSON.stringify(opt.default)}`;
}

export function renderHelpText() {
  const lines = [
    "@pilely/create-pilely-app",
    "",
    "Turns an empty directory into a running, standards-conformant Pilely",
    "neoApp: a Vite + React SPA laid out the way the platform's own SPA is,",
    "with the chosen @pilely/* service packages installed.",
    "",
    "Usage: create-pilely-app <project-directory> [options]",
    "",
    "Agent mode runs non-interactively (no TTY needed) once every required",
    "option is given as a flag. Human mode prompts for the same options, in",
    "the same order, when stdin is a TTY and the configuration is",
    "incomplete. --yes / --no-input force agent mode even then, turning a",
    "still-missing required option into an error instead of a prompt.",
    "",
    "Options:",
  ];
  for (const opt of OPTION_SCHEMA) {
    lines.push(`  ${describeFlags(opt)}`);
    lines.push(`      ${opt.description}`);
    lines.push(`      (${describeType(opt)}, ${describeRequirement(opt)})`);
  }
  lines.push("");
  lines.push("One-shot agent example:");
  lines.push(`  ${ONE_SHOT_EXAMPLE}`);
  lines.push("");
  return lines.join("\n");
}

/** The option schema itself as data, so a caller enumerates options instead
 *  of parsing prose. */
export function renderHelpJson() {
  return JSON.stringify(OPTION_SCHEMA, null, 2);
}
