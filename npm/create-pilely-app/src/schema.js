// The single source of truth for every `create-pilely-app` option. Every
// other piece of the CLI — argv parsing, the interactive prompt sequence,
// `--help` text, `--help --json`, and validation — reads from this list.
// Nothing about an option is ever hand-duplicated anywhere else: adding an
// option here is what makes it show up everywhere else too.
//
// The resolved options object every generator function is written against
// (produced by the CLI wiring in src/cli.js from this schema):
//
//   {
//     projectDir: string,   // absolute path
//     services: string[],   // subset of ["simple-db","simple-blob","simple-group","simple-email"], [] for "none"
//     signIn: boolean,
//     appId: string,        // the given value, or "REPLACE_WITH_YOUR_PILE_ID" if none given
//     install: boolean,
//     json: boolean,
//   }
//
// @typedef {Object} OptionDescriptor
// @property {string} key - canonical key in the resolved options object
// @property {string[]} flags - the flag spelling(s); empty for a positional
// @property {boolean} positional - true only for the project directory
// @property {"string"|"boolean"|"enum-csv"} type
// @property {string[]|null} choices - allowed values for an enum-csv type, null otherwise
// @property {*} default - the value used when nothing is supplied; undefined when there is none
// @property {boolean} required
// @property {string} description - one line, used in --help output

export const SERVICE_NAMES = [
  "simple-db",
  "simple-blob",
  "simple-group",
  "simple-email",
];

/** @type {OptionDescriptor[]} */
export const OPTION_SCHEMA = [
  {
    key: "projectDir",
    flags: [],
    positional: true,
    type: "string",
    choices: null,
    default: undefined,
    required: true,
    description: "The directory to create the neoApp in. Refused if it exists and is non-empty.",
  },
  {
    key: "services",
    flags: ["--services"],
    positional: false,
    type: "enum-csv",
    choices: [...SERVICE_NAMES, "none"],
    default: undefined,
    required: true,
    description:
      "Comma list of @pilely/* service packages to install (simple-db,simple-blob,simple-group,simple-email), or \"none\". @pilely/core is always installed regardless.",
  },
  {
    key: "signIn",
    flags: ["--sign-in", "--no-sign-in"],
    positional: false,
    type: "boolean",
    choices: null,
    default: false,
    required: false,
    description: "Emit the \"Login with Pilely\" affordance. client.js is always emitted either way.",
  },
  {
    key: "appId",
    flags: ["--app-id"],
    positional: false,
    type: "string",
    choices: null,
    default: null,
    required: false,
    description:
      "The registered pile id for <meta name=\"pilely-app\">. Defaults to a loud REPLACE_WITH_YOUR_PILE_ID placeholder.",
  },
  {
    key: "install",
    flags: ["--install", "--no-install"],
    positional: false,
    type: "boolean",
    choices: null,
    default: true,
    required: false,
    description: "Run npm install after writing the project. --no-install makes zero network calls.",
  },
  {
    key: "json",
    flags: ["--json"],
    positional: false,
    type: "boolean",
    choices: null,
    default: false,
    required: false,
    description: "Print a machine-readable result to stdout instead of human text.",
  },
  {
    key: "yes",
    flags: ["--yes", "--no-input"],
    positional: false,
    type: "boolean",
    choices: null,
    default: false,
    required: false,
    description:
      "Force non-interactive (agent) mode even when required options are missing; missing required options then error instead of prompting.",
  },
  {
    key: "help",
    flags: ["--help"],
    positional: false,
    type: "boolean",
    choices: null,
    default: false,
    required: false,
    description: "Print this help and exit. --help --json prints the option schema as JSON.",
  },
];
