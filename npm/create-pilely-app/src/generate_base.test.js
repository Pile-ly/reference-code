import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateBaseProject } from "./generate_base.js";

function listAllFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listAllFiles(join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

test("generateBaseProject writes exactly the base skeleton and nothing else", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "create-pilely-app-base-"));
  try {
    const resolvedOptions = {
      projectDir: targetDir,
      services: ["simple-db"],
      signIn: false,
      appId: "REPLACE_WITH_YOUR_PILE_ID",
      install: false,
      json: false,
    };

    const { filesWritten } = generateBaseProject(targetDir, resolvedOptions);

    const expected = [
      "package.json",
      "README.md",
      ".env.mock",
      "tsconfig.json",
      "postcss.config.cjs",
      "vite.config.ts",
      "index.html",
      "src/main.tsx",
      "src/router.tsx",
      "src/vite-env.d.ts",
      "src/index_html_conformance.test.ts",
      "src/pages/HomePage.tsx",
      "src/styles/globals.css",
    ];

    assert.deepEqual([...filesWritten].sort(), [...expected].sort());
    assert.deepEqual(listAllFiles(targetDir), [...expected].sort());

    // No components/, hooks/, lib/, stores/, public/, i18n/ -- only files
    // that have content this task calls for.
    for (const forbidden of ["hooks", "lib", "components", "stores", "public", "i18n"]) {
      assert.ok(
        !filesWritten.some((f) => f.startsWith(`${forbidden}/`) || f.startsWith(`src/${forbidden}/`)),
        `unexpected ${forbidden}/ directory`,
      );
    }

    const indexHtml = readFileSync(join(targetDir, "index.html"), "utf8");
    const metaIdx = indexHtml.indexOf('<meta name="pilely-app" content="%PILELY_APP_ID%"');
    const clientIdx = indexHtml.indexOf("/~/client.js");
    assert.ok(metaIdx > -1, "meta pilely-app tag missing");
    assert.ok(clientIdx > -1, "client.js script missing");
    assert.ok(metaIdx < clientIdx, "meta tag must come before client.js");

    const viteConfig = readFileSync(join(targetDir, "vite.config.ts"), "utf8");
    assert.ok(viteConfig.includes('"REPLACE_WITH_YOUR_PILE_ID"'), "default appId missing");
    assert.ok(!viteConfig.includes("server.proxy") && !viteConfig.includes("proxy:"), "server.proxy block must be dropped");
    assert.ok(
      !viteConfig.includes('"import.meta.env.PILELY_APP_ID"'),
      "PILELY_APP_ID must never be defined for JS",
    );

    const packageJson = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies["@pilely/core"], "^0.4.0");
    assert.equal(packageJson.dependencies["@pilely/simple-db"], "^0.4.0");
    assert.equal(packageJson.dependencies["@tanstack/react-query"], "^5.0.0");
    assert.ok(!("zustand" in packageJson.dependencies));
    assert.ok(!packageJson.dependencies["@pilely/simple-blob"]);
    assert.ok(!packageJson.dependencies["@pilely/simple-group"]);
    assert.ok(!packageJson.dependencies["@pilely/simple-email"]);

    const mainTsx = readFileSync(join(targetDir, "src/main.tsx"), "utf8");
    assert.ok(mainTsx.includes('import { PilelyProvider, appId } from "@pilely/core";'));
    assert.ok(mainTsx.includes("REPLACE_WITH_YOUR_PILE_ID"));
    // The provider wraps the router, so every route renders inside it.
    assert.match(
      mainTsx,
      /<PilelyProvider>\s*<RouterProvider router=\{router\} \/>\s*<\/PilelyProvider>/,
    );

    const readme = readFileSync(join(targetDir, "README.md"), "utf8");
    assert.match(readme, /^## Data and auth$/m);
    assert.ok(readme.includes("<PilelyProvider>"));
    assert.ok(readme.includes("usePilelyAuth()"));
    assert.ok(readme.includes("Writes refresh reads."));

    // An app is reached only on its own host: nothing generated names an app
    // path or a handle-prefixed URL, and vite's base is the host root.
    assert.ok(viteConfig.includes('base: "/",'), 'vite base must be "/"');
    for (const rel of expected) {
      const text = readFileSync(join(targetDir, rel), "utf8");
      assert.doesNotMatch(text, /pile_pat[h]|\/@[A-Za-z<]/, `${rel} names an app path or a handle-prefixed URL`);
    }
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test("every generated @pilely range is ^0.4.0, but simple-group's ^0.5.0", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "create-pilely-app-ranges-"));
  try {
    generateBaseProject(targetDir, {
      projectDir: targetDir,
      services: ["simple-db", "simple-blob", "simple-group", "simple-email"],
      signIn: false,
      appId: "REPLACE_WITH_YOUR_PILE_ID",
      install: false,
      json: false,
    });
    const { dependencies } = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8"));
    const pilely = Object.entries(dependencies).filter(([name]) => name.startsWith("@pilely/"));
    assert.deepEqual(pilely.map(([name]) => name).sort(), [
      "@pilely/core",
      "@pilely/simple-blob",
      "@pilely/simple-db",
      "@pilely/simple-email",
      "@pilely/simple-group",
    ]);
    for (const [name, range] of pilely) {
      assert.equal(range, name === "@pilely/simple-group" ? "^0.5.0" : "^0.4.0", name);
    }
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test("dev:mock turns mock mode on through vite --mode mock and .env.mock", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "create-pilely-app-mock-"));
  try {
    generateBaseProject(targetDir, {
      projectDir: targetDir,
      services: [],
      signIn: false,
      appId: "REPLACE_WITH_YOUR_PILE_ID",
      install: false,
      json: false,
    });

    const { scripts } = JSON.parse(readFileSync(join(targetDir, "package.json"), "utf8"));
    // A --mode flag, not a shell assignment: portable across sh, PowerShell, cmd.
    assert.equal(scripts["dev:mock"], "vite --mode mock");
    assert.equal(scripts.dev, "vite");
    assert.ok(!/PILELY_MOCK/.test(scripts.build), "production build must not set the flag");

    const envMock = readFileSync(join(targetDir, ".env.mock"), "utf8");
    assert.match(envMock, /^VITE_PILELY_MOCK=1$/m);

    const viteConfig = readFileSync(join(targetDir, "vite.config.ts"), "utf8");
    assert.ok(viteConfig.includes('import { defineConfig, loadEnv } from "vite";'));
    assert.ok(viteConfig.includes('loadEnv(mode, process.cwd(), "VITE_").VITE_PILELY_MOCK === "1"'));
    assert.ok(viteConfig.includes("pilelyApexInHtml(mock)"));

    const readme = readFileSync(join(targetDir, "README.md"), "utf8");
    assert.match(readme, /^## Mock mode$/m);
    assert.ok(readme.includes("npm run dev:mock"));
    assert.ok(readme.includes("VITE_PILELY_MOCK"));
    assert.ok(readme.includes("seedMock("));
    assert.ok(readme.includes("resetMock()"));
    assert.ok(readme.includes("do not model access rules"));
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

// The generated plugin, lifted out of vite.config.ts and run: the type
// annotations are its only TypeScript, so stripping them leaves plain JS.
function loadApexPlugin(viteConfig, env) {
  const start = viteConfig.indexOf("const PILELY_BASE_DOMAIN");
  const end = viteConfig.indexOf("export default defineConfig");
  const body = viteConfig
    .slice(start, end)
    .replace("(mock: boolean)", "(mock)")
    .replace("(html: string)", "(html)");
  return new Function("process", `${body}\nreturn pilelyApexInHtml;`)({ env });
}

test("the generated vite config drops the platform tags only in mock mode", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "create-pilely-app-tags-"));
  try {
    generateBaseProject(targetDir, {
      projectDir: targetDir,
      services: [],
      signIn: false,
      appId: "my-pile",
      install: false,
      json: false,
    });
    const indexHtml = readFileSync(join(targetDir, "index.html"), "utf8");
    const viteConfig = readFileSync(join(targetDir, "vite.config.ts"), "utf8");
    const pilelyApexInHtml = loadApexPlugin(viteConfig, {});

    const real = pilelyApexInHtml(false).transformIndexHtml(indexHtml);
    assert.ok(real.includes('<meta name="pilely-app" content="my-pile" />'));
    assert.ok(real.includes('<script src="https://pilely.app/~/client.js"></script>'));
    assert.ok(!real.includes("%PILELY_"));

    const mock = pilelyApexInHtml(true).transformIndexHtml(indexHtml);
    assert.ok(!mock.includes("<meta name=\"pilely-app\""), "pilely-app meta must be dropped");
    assert.ok(!/<script[^>]*client\.js/.test(mock), "client.js script must be dropped");
    assert.ok(!/<script[^>]*src="https:/.test(mock), "no remote script may remain");
    assert.ok(mock.includes('<script type="module" src="/src/main.tsx"></script>'));
    assert.ok(mock.includes("window.__PILELY_APP__"), "the §9a bootstrap stays");

    // The source keeps both tags; the conformance test reads them there.
    assert.ok(indexHtml.includes('<meta name="pilely-app" content="%PILELY_APP_ID%" />'));
    assert.ok(indexHtml.includes('<script src="https://%PILELY_BASE_DOMAIN%/~/client.js"></script>'));
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});
