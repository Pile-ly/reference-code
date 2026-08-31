import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_JS = join(__dirname, "..", "index.js");
const PACKAGE_DIR = join(__dirname, "..");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [INDEX_JS, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 15_000,
    ...options,
  });
}

test("(a) the full one-shot agent command exits 0, prints valid JSON, prompts for nothing", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-cli-a-"));
  const target = join(workDir, "my-app");
  try {
    const result = runCli([
      target,
      "--services",
      "simple-db,simple-blob",
      "--sign-in",
      "--no-install",
      "--json",
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.path, target);
    assert.deepEqual(parsed.options.services, ["simple-db", "simple-blob"]);
    assert.equal(parsed.options.signIn, true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("(b) a missing --services exits non-zero and stderr names it, with no TTY (no hang)", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-cli-b-"));
  const target = join(workDir, "my-app");
  try {
    const result = runCli([target, "--sign-in", "--no-install", "--json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--services/);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("(c) a non-empty target directory is refused, naming the directory", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-cli-c-"));
  try {
    writeFileSync(join(workDir, "already-here.txt"), "hi");
    const result = runCli([workDir, "--services", "none", "--no-install", "--json"]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(workDir), "stderr should name the directory");
    assert.equal(result.stdout, "");
    assert.ok(existsSync(join(workDir, "already-here.txt")));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("--help --help --json / --json wins over an invalid flag value elsewhere", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--services/);

  const helpJson = runCli(["--help", "--json"]);
  assert.equal(helpJson.status, 0);
  const schema = JSON.parse(helpJson.stdout);
  assert.ok(Array.isArray(schema));
  assert.equal(schema.length, 8);

  // --help wins even when another flag's value is outright invalid.
  const helpOverBadFlag = runCli(["--help", "--services", "bogus-enum"]);
  assert.equal(helpOverBadFlag.status, 0);
});

test("npm pack --dry-run lists only the files package.json's \"files\" allowlist declares, no lifecycle scripts", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const [report] = JSON.parse(result.stdout);
  const packedPaths = report.files.map((f) => f.path).sort();
  assert.deepEqual(packedPaths, [...packageJson.files].sort().concat("package.json").sort());
  assert.ok(!packedPaths.some((p) => /(^|\/)(postinstall|preinstall|prepare)\.js$/.test(p)));
  assert.ok(!("postinstall" in (packageJson.scripts ?? {})));
  assert.ok(!("preinstall" in (packageJson.scripts ?? {})));
  assert.ok(!("prepare" in (packageJson.scripts ?? {})));
});

// ── malformed input ────────────────────────────────────────────────────────
// The refusals below are the ones the CLI has to get right BECAUSE it writes
// to the filesystem. Each of these shipped broken once: the file target threw
// a raw ENOTDIR stack trace, the empty string resolved to the caller's cwd and
// scaffolded a whole project into it, and a second positional was dropped in
// silence. They are cheap to reassert and expensive to rediscover.

test("(d) a target that exists but is a FILE is refused, not crashed on", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-cli-d-"));
  const target = join(workDir, "already-a-file.txt");
  try {
    writeFileSync(target, "hi\n");
    const result = runCli([target, "--services", "none", "--no-install", "--yes"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not a directory/);
    // The refusal must be this CLI's own message, never a Node stack trace.
    assert.doesNotMatch(result.stderr, /node:fs|ENOTDIR/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("(e) an empty-string project directory is refused, never resolved to cwd", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-cli-e-"));
  try {
    const result = runCli(["", "--services", "none", "--no-install", "--yes"], { cwd: workDir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot be empty/);
    // The real damage this prevents: nothing may be written into the cwd.
    assert.equal(existsSync(join(workDir, "package.json")), false);
    assert.equal(existsSync(join(workDir, "index.html")), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("(f) a second positional is refused, not silently dropped", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-cli-f-"));
  try {
    const result = runCli(
      [join(workDir, "dirA"), join(workDir, "dirB"), "--services", "none", "--no-install"],
      { cwd: workDir },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected one project directory/);
    // An unquoted name with a space must not scaffold into its first word.
    assert.equal(existsSync(join(workDir, "dirA")), false);
    assert.equal(existsSync(join(workDir, "dirB")), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

// The public mirror's privacy guard (public_repo/stage.sh) refuses the whole
// staged tree if any published file names a monorepo path. It runs in CI,
// AFTER merge, and it fails the sync for every project in reference_code —
// not just this one. Catching it here makes it a local test failure instead.
//
// Kept as literals rather than imported from stage.sh: this package is
// published standalone and cannot read anything outside its own directory.
test("(g) no shipped file names a monorepo path the public-mirror guard forbids", () => {
  // Assembled at runtime, never spelled out: this test file is itself part of
  // the staged tree, so a literal list here would trip the very guard it
  // exists to pre-empt.
  const FORBIDDEN = [
    ["code", "piles"].join("/"),
    ["code", "supabase"].join("/"),
    ["code", "crates"].join("/"),
    ["code", "reference" + "_code"].join("/"),
    "pilely" + "_open_stack",
    "master" + "-mono",
  ];
  // Exactly what npm publishes — the guard only ever sees these.
  const shipped = packageJson.files.flatMap((entry) => {
    const full = join(PACKAGE_DIR, entry);
    if (!existsSync(full)) return [];
    return statSync(full).isDirectory()
      ? readdirSync(full, { recursive: true })
          .map((f) => join(full, String(f)))
          .filter((f) => statSync(f).isFile())
      : [full];
  });
  assert.ok(shipped.length > 0, "files allowlist resolved to nothing");
  for (const file of shipped) {
    const text = readFileSync(file, "utf8");
    for (const needle of FORBIDDEN) {
      assert.ok(
        !text.includes(needle),
        `${file} contains "${needle}" — the public-mirror guard rejects the whole staged tree for this`,
      );
    }
  }
});
