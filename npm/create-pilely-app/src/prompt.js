// Human-mode interactive prompt sequence -- node:readline/promises, no
// external prompt library. Walks OPTION_SCHEMA in order: an option already
// supplied as a flag is kept exactly as given and skipped; everything else
// is prompted, showing the schema default inline, with an empty answer
// meaning "accept the default" and an invalid answer re-prompting the same
// option. A new schema entry gets this same treatment automatically.

import { createInterface } from "node:readline/promises";

import { OPTION_SCHEMA } from "./schema.js";
import { validateOptionValue } from "./validate.js";

function flagKey(flag) {
  return flag.replace(/^--/, "");
}

function isSupplied(opt, values, positionals) {
  if (opt.positional) return positionals[0] !== undefined;
  if (opt.type === "boolean") {
    return opt.flags.some((f) => values[flagKey(f)] === true);
  }
  return values[flagKey(opt.flags[0])] !== undefined;
}

function resolveSuppliedBoolean(opt, values) {
  const [onFlag, offFlag] = opt.flags;
  if (values[flagKey(onFlag)] === true) return true;
  if (offFlag && values[flagKey(offFlag)] === true) return false;
  return opt.default;
}

/**
 * @param {Record<string, unknown>} values - parseArgs' `values`, flags already supplied
 * @param {string[]} positionals - parseArgs' `positionals`
 * @returns {Promise<Record<string, unknown>>} the resolved options, keyed by schema `key`
 */
export async function promptForMissing(values, positionals) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const resolved = {};
  try {
    for (const opt of OPTION_SCHEMA) {
      // "help" is a meta flag, never part of the resolved options. "yes"
      // only means "force non-interactive" -- meaningless to ask about
      // once already in this interactive sequence.
      if (opt.key === "help" || opt.key === "yes") continue;

      if (isSupplied(opt, values, positionals)) {
        if (opt.positional) {
          resolved[opt.key] = positionals[0];
        } else if (opt.type === "boolean") {
          resolved[opt.key] = resolveSuppliedBoolean(opt, values);
        } else {
          resolved[opt.key] = validateOptionValue(opt, values[flagKey(opt.flags[0])]).value;
        }
        continue;
      }

      if (opt.type === "boolean") {
        const hint = opt.default ? "Y/n" : "y/N";
        for (;;) {
          const answer = (await rl.question(`${opt.description} [${hint}]: `)).trim().toLowerCase();
          if (answer === "") {
            resolved[opt.key] = opt.default;
            break;
          }
          if (answer === "y" || answer === "yes") {
            resolved[opt.key] = true;
            break;
          }
          if (answer === "n" || answer === "no") {
            resolved[opt.key] = false;
            break;
          }
          process.stderr.write("Please answer y or n.\n");
        }
        continue;
      }

      const defaultLabel = opt.default === undefined ? "no default" : JSON.stringify(opt.default);
      const choicesHint = opt.choices ? ` (${opt.choices.join(", ")})` : "";
      for (;;) {
        const answer = (
          await rl.question(`${opt.description}${choicesHint} [default: ${defaultLabel}]: `)
        ).trim();
        if (answer === "") {
          if (opt.required) {
            process.stderr.write("This option is required.\n");
            continue;
          }
          resolved[opt.key] = opt.default;
          break;
        }
        const result = validateOptionValue(opt, answer);
        if (!result.ok) {
          const validValues = opt.choices ? opt.choices.join(", ") : "any string";
          process.stderr.write(`Invalid value: ${result.message}. Valid values: ${validValues}.\n`);
          continue;
        }
        resolved[opt.key] = result.value;
        break;
      }
    }
  } finally {
    rl.close();
  }
  return resolved;
}
