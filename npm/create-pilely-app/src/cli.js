// The entry point's real logic: argv parsing, mode dispatch, the non-empty
// directory refusal, calling the generators, running npm install, and
// --json / human output. index.js is the thin bin shim that calls run().

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { OPTION_SCHEMA, SERVICE_NAMES } from "./schema.js";
import { renderHelpJson, renderHelpText } from "./help.js";
import { promptForMissing } from "./prompt.js";
import { validateOptionValue } from "./validate.js";
import { generateBaseProject } from "./generate_base.js";
import { generateSignIn } from "./generate_sign_in.js";

export const PLACEHOLDER_APP_ID = "REPLACE_WITH_YOUR_PILE_ID";

function flagKey(flag) {
  return flag.replace(/^--/, "");
}

function buildParseArgsOptions() {
  /** @type {Record<string, {type: "boolean" | "string"}>} */
  const options = {};
  for (const opt of OPTION_SCHEMA) {
    for (const flag of opt.flags) {
      options[flagKey(flag)] = { type: opt.type === "boolean" ? "boolean" : "string" };
    }
  }
  return options;
}

function resolveBoolean(onFlag, offFlag, values, def) {
  if (values[flagKey(onFlag)] === true) return true;
  if (values[flagKey(offFlag)] === true) return false;
  return def;
}

function refuseIfNonEmpty(dir) {
  if (!existsSync(dir)) return false;
  // The path exists but may not be a directory. readdirSync on a file throws
  // ENOTDIR, which would surface as a raw Node stack trace instead of this
  // function's own refusal -- so the kind is checked before it is read.
  if (!statSync(dir).isDirectory()) {
    process.stderr.write(`create-pilely-app: target "${dir}" already exists and is not a directory.\n`);
    process.exitCode = 1;
    return true;
  }
  if (readdirSync(dir).length > 0) {
    process.stderr.write(`create-pilely-app: target directory "${dir}" already exists and is not empty.\n`);
    process.exitCode = 1;
    return true;
  }
  return false;
}

/**
 * @param {string[]} argv - process.argv (script name and node path included)
 */
export async function run(argv) {
  const rawArgs = argv.slice(2);

  // Precedence 0(i): --help / --help --json win over every other failure,
  // including an outright invalid flag value elsewhere -- a raw-argv scan
  // for the literal token, performed before the schema-validating parse
  // ever runs.
  if (rawArgs.includes("--help")) {
    process.stdout.write((rawArgs.includes("--json") ? renderHelpJson() : renderHelpText()) + "\n");
    process.exitCode = 0;
    return;
  }

  // node:util's parseArgs is enough for this flat flag set -- a Node >=20
  // builtin, not a new dependency.
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: rawArgs,
      options: buildParseArgsOptions(),
      allowPositionals: true,
      strict: true,
    }));
  } catch (err) {
    process.stderr.write(`create-pilely-app: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  // The positional is the project directory, and there is exactly one of it.
  // Both checks run before validation and dispatch, because both would
  // otherwise be absorbed silently: an unquoted name with a space arrives as
  // two positionals and everything past the first is dropped, and an empty
  // string passes the `!== undefined` "was it supplied" test everywhere below
  // while `resolve("")` yields the CURRENT directory -- so a shell variable
  // that expanded to nothing would scaffold a project into the caller's cwd.
  if (positionals.length > 1) {
    process.stderr.write(
      `create-pilely-app: expected one project directory, got ${positionals.length}: ${positionals.map((p) => JSON.stringify(p)).join(" ")}. Quote the name if it contains spaces, and put flags after it.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (positionals[0] !== undefined && positionals[0].trim() === "") {
    process.stderr.write("create-pilely-app: project directory cannot be empty.\n");
    process.exitCode = 1;
    return;
  }

  // Point 1: every SUPPLIED flag value is validated immediately, before
  // mode dispatch runs. Invalid is always an error, in every mode -- never
  // "not supplied" (which would fall through to a default or a prompt),
  // never silently coerced.
  const validated = {};
  for (const opt of OPTION_SCHEMA) {
    if (opt.positional || opt.type === "boolean") continue;
    const key = flagKey(opt.flags[0]);
    if (values[key] === undefined) continue;
    const result = validateOptionValue(opt, values[key]);
    if (!result.ok) {
      const validValues = opt.choices ? opt.choices.join(", ") : "any string";
      process.stderr.write(
        `create-pilely-app: invalid ${opt.flags[0]} value ${JSON.stringify(values[key])}: ${result.message}. Valid values: ${validValues}.\n`,
      );
      process.exitCode = 1;
      return;
    }
    validated[opt.key] = result.value;
  }

  // Precedence 0(ii)/point 4: non-empty directory refusal, before mode
  // dispatch, in every mode -- but only once a directory value has been
  // resolved from the positional. When the positional is omitted there is
  // nothing to refuse; that falls through to mode dispatch below.
  if (positionals[0] !== undefined && refuseIfNonEmpty(resolve(positionals[0]))) {
    return;
  }

  const dirSupplied = positionals[0] !== undefined;
  const servicesSupplied = values.services !== undefined;
  const forceNonInteractive = values.yes === true || values["no-input"] === true;

  let resolvedOptions;
  if (dirSupplied && servicesSupplied) {
    // Point 2(i): agent mode -- every required option arrived as a flag,
    // runs immediately, no prompt, regardless of --yes/--no-input or TTY.
    resolvedOptions = {
      projectDir: resolve(positionals[0]),
      services: validated.services,
      signIn: resolveBoolean("--sign-in", "--no-sign-in", values, false),
      appId: values["app-id"] ?? PLACEHOLDER_APP_ID,
      install: resolveBoolean("--install", "--no-install", values, true),
      json: values.json === true,
    };
  } else if (process.stdin.isTTY && !forceNonInteractive) {
    // Point 2(ii): human mode -- a required option is missing, stdin IS a
    // TTY, and --yes/--no-input was not passed.
    const answers = await promptForMissing(values, positionals);
    const projectDir = resolve(answers.projectDir);
    if (refuseIfNonEmpty(projectDir)) return;
    resolvedOptions = {
      projectDir,
      services: answers.services,
      signIn: answers.signIn,
      appId: answers.appId ?? PLACEHOLDER_APP_ID,
      install: answers.install,
      json: answers.json,
    };
  } else {
    // Point 2(iii): ERROR -- a required option is missing and (ii) does not
    // hold (no TTY, or --yes/--no-input was passed). --yes/--no-input only
    // waives the interactive prompt, never the requiredness of an option.
    const missing = [];
    if (!dirSupplied) missing.push("project directory (positional)");
    if (!servicesSupplied) missing.push("--services");
    process.stderr.write(
      `create-pilely-app: missing required option(s): ${missing.join(", ")}. ` +
        `--services accepts a comma list of ${SERVICE_NAMES.join(",")}, or "none".\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Point 6: base skeleton always, sign-in affordance only when requested.
  const filesWritten = [];
  const base = generateBaseProject(resolvedOptions.projectDir, resolvedOptions);
  filesWritten.push(...base.filesWritten);
  if (resolvedOptions.signIn) {
    const signIn = generateSignIn(resolvedOptions.projectDir, resolvedOptions);
    for (const f of signIn.filesWritten) {
      if (!filesWritten.includes(f)) filesWritten.push(f);
    }
  }

  // Point 7: npm install, blocking, with its own stdout/stderr routed to
  // OUR stderr so it never leaks into the --json stdout stream. A
  // non-network --no-install skips this entirely.
  let installAttempted = false;
  let installOk = true;
  if (resolvedOptions.install) {
    installAttempted = true;
    const result = spawnSync("npm", ["install"], {
      cwd: resolvedOptions.projectDir,
      stdio: ["ignore", 2, 2],
    });
    installOk = result.status === 0;
  }

  // Point 8: install failing does not turn a successful generation into
  // the error path -- the deliverable (a valid project on disk) exists
  // regardless of install's outcome.
  const nextCommand =
    resolvedOptions.install && installOk
      ? `cd ${resolvedOptions.projectDir} && npm run dev`
      : `cd ${resolvedOptions.projectDir} && npm install`;

  if (resolvedOptions.json) {
    /** @type {Record<string, unknown>} */
    const summary = {
      path: resolvedOptions.projectDir,
      options: resolvedOptions,
      filesWritten,
      nextCommand,
    };
    if (installAttempted) {
      summary.install = { attempted: true, ok: installOk };
    }
    process.stdout.write(JSON.stringify(summary) + "\n");
  } else {
    process.stderr.write(`Created ${resolvedOptions.projectDir}\n`);
    if (installAttempted && !installOk) {
      process.stderr.write("npm install failed -- re-run it manually.\n");
    }
    process.stderr.write(`Next: ${nextCommand}\n`);
  }

  process.exitCode = 0;
}
