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
    assert.ok(packageJson.dependencies["@pilely/core"]);
    assert.ok(packageJson.dependencies["@pilely/simple-db"]);
    assert.ok(!packageJson.dependencies["@pilely/simple-blob"]);
    assert.ok(!packageJson.dependencies["@pilely/simple-group"]);
    assert.ok(!packageJson.dependencies["@pilely/simple-email"]);

    const mainTsx = readFileSync(join(targetDir, "src/main.tsx"), "utf8");
    assert.ok(mainTsx.includes('from "@pilely/core"'));
    assert.ok(mainTsx.includes("REPLACE_WITH_YOUR_PILE_ID"));
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});
