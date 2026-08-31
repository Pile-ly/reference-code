// The whole shipped CLI, end to end -- exactly the scenarios the task's own
// "## Proof" section describes. This suite is allowed to be slow: it runs
// real npm installs and real build/typecheck/test cycles. spawnSync
// timeouts are generous but bounded, so a genuine hang still fails the
// test instead of hanging CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OPTION_SCHEMA } from "./schema.js";
import packageJson from "../package.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(__dirname, "..");
const INDEX_JS = join(PACKAGE_DIR, "index.js");
const NPM_ROOT = join(PACKAGE_DIR, "..");
const CORE_DIR = join(NPM_ROOT, "core");
const SIMPLE_DB_DIR = join(NPM_ROOT, "simple-db");

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [INDEX_JS, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 30_000,
    ...opts,
  });
}

function listRelative(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listRelative(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

// `@pilely/core` (and the four service packages) are NOT YET PUBLISHED to
// the npm registry -- confirmed in local/STOA/agent/npm_client_packages.md.
// A real, unmodified `npm install` against a generated project's
// "@pilely/core": "^0.1.0" would 404. TEST-ONLY infrastructure: rewrite a
// COPY of the generated package.json to point those two entries at the
// locally built packages via `file:`, purely so `npm install` succeeds in
// this sandboxed proof. The shipped generator itself never does this --
// see the assertion against the unmodified package.json below, which runs
// BEFORE this substitution and is what actually proves the generator
// correct.
function substituteLocalPilelyPackages(projectDir) {
  const pkgPath = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.dependencies["@pilely/core"]) {
    pkg.dependencies["@pilely/core"] = `file:${CORE_DIR}`;
  }
  if (pkg.dependencies["@pilely/simple-db"]) {
    pkg.dependencies["@pilely/simple-db"] = `file:${SIMPLE_DB_DIR}`;
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

test("setup: build @pilely/core and @pilely/simple-db locally", () => {
  const coreBuild = sh("npm", ["run", "build"], { cwd: CORE_DIR, timeout: 120_000 });
  assert.equal(coreBuild.status, 0, coreBuild.stderr);
  const dbBuild = sh("npm", ["run", "build"], { cwd: SIMPLE_DB_DIR, timeout: 120_000 });
  assert.equal(dbBuild.status, 0, dbBuild.stderr);
  assert.ok(existsSync(join(CORE_DIR, "dist", "index.js")));
  assert.ok(existsSync(join(SIMPLE_DB_DIR, "dist", "index.js")));
});

test("(a) one-shot agent run, no TTY, --no-install: exits 0, stdout is valid JSON, nothing read from stdin", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-e2e-a-"));
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
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.path, target);
    assert.ok(!("install" in parsed) || parsed.install === undefined);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("(b) --services removed: non-zero exit, stderr names --services", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-e2e-b-"));
  const target = join(workDir, "my-app");
  try {
    const result = runCli([target, "--sign-in", "--no-install", "--json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--services/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

for (const signIn of [true, false]) {
  test(`(c) full --install build/typecheck/test cycle (${signIn ? "--sign-in" : "--no-sign-in"})`, () => {
    const workDir = mkdtempSync(join(tmpdir(), `create-pilely-app-e2e-c-${signIn ? "signin" : "nosignin"}-`));
    const target = join(workDir, "app");
    try {
      const genResult = runCli([
        target,
        "--services",
        "simple-db",
        signIn ? "--sign-in" : "--no-sign-in",
        "--no-install",
        "--json",
      ]);
      assert.equal(genResult.status, 0, genResult.stderr);

      // The generator's OWN output, before any test-only substitution:
      // correct, unmodified registry semver.
      const pkgBefore = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
      assert.equal(pkgBefore.dependencies["@pilely/core"], "^0.1.0");
      assert.equal(pkgBefore.dependencies["@pilely/simple-db"], "^0.1.0");

      // requirement 6: client.js ships regardless of --sign-in.
      const html = readFileSync(join(target, "index.html"), "utf8");
      assert.ok(html.includes("/~/client.js"));

      substituteLocalPilelyPackages(target);

      const install = sh("npm", ["install"], { cwd: target, timeout: 300_000 });
      assert.equal(install.status, 0, install.stderr);

      const build = sh("npm", ["run", "build"], { cwd: target, timeout: 120_000 });
      assert.equal(build.status, 0, build.stderr);

      const typecheck = sh("npm", ["run", "typecheck"], { cwd: target, timeout: 60_000 });
      assert.equal(typecheck.status, 0, typecheck.stderr);

      const testRun = sh("npm", ["test"], { cwd: target, timeout: 60_000 });
      const testOutput = testRun.stdout + testRun.stderr;
      assert.equal(testRun.status, 0, testOutput);
      // Confirm the copied conformance test actually ran and passed --
      // don't just trust the overall exit code, a config mistake could
      // silently exclude the file from the run.
      assert.match(testOutput, /index_html_conformance/);

      const homePage = readFileSync(join(target, "src/pages/HomePage.tsx"), "utf8");
      if (signIn) {
        assert.ok(homePage.includes("SignInButton"));
      } else {
        assert.ok(!homePage.includes("SignInButton"));
        assert.ok(!existsSync(join(target, "src/components")));
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}

test("(d) --help matches the schema exactly; --help --json parses to the same option set", () => {
  const helpText = runCli(["--help"]);
  assert.equal(helpText.status, 0);
  for (const opt of OPTION_SCHEMA) {
    const flags = opt.positional ? ["<project-directory>"] : opt.flags;
    for (const f of flags) {
      assert.ok(helpText.stdout.includes(f), `--help text missing ${f}`);
    }
  }

  const helpJson = runCli(["--help", "--json"]);
  assert.equal(helpJson.status, 0);
  const parsedSchema = JSON.parse(helpJson.stdout);
  const parsedKeys = parsedSchema.map((o) => o.key).sort();
  const schemaKeys = OPTION_SCHEMA.map((o) => o.key).sort();
  assert.deepEqual(parsedKeys, schemaKeys);
});

test("(e) npm pack --dry-run matches the files allowlist, no lifecycle scripts", () => {
  const result = sh("npm", ["pack", "--dry-run", "--json"], { cwd: PACKAGE_DIR, timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const [report] = JSON.parse(result.stdout);
  const packedPaths = report.files.map((f) => f.path).sort();
  const expected = [...new Set([...packageJson.files, "package.json"])].sort();
  assert.deepEqual(packedPaths, expected);
  for (const script of ["postinstall", "preinstall", "prepare"]) {
    assert.ok(!(script in (packageJson.scripts ?? {})), `package.json has a "${script}" script`);
  }
});

test("(f) a non-empty target directory is refused and nothing new is written into it", () => {
  const workDir = mkdtempSync(join(tmpdir(), "create-pilely-app-e2e-f-"));
  try {
    writeFileSync(join(workDir, "already-here.txt"), "hi");
    const before = listRelative(workDir);

    const result = runCli([workDir, "--services", "none", "--sign-in", "--no-install", "--json"]);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(workDir));
    assert.equal(result.stdout, "");

    const after = listRelative(workDir);
    assert.deepEqual(after, before);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
