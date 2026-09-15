import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateBaseProject } from "./generate_base.js";
import { generateSignIn } from "./generate_sign_in.js";

function makeOptions(projectDir, signIn) {
  return {
    projectDir,
    services: [],
    signIn,
    appId: "REPLACE_WITH_YOUR_PILE_ID",
    install: false,
    json: false,
  };
}

test("the full pipeline wires the sign-in affordance only when signIn is true", () => {
  const signInDir = mkdtempSync(join(tmpdir(), "create-pilely-app-signin-"));
  const noSignInDir = mkdtempSync(join(tmpdir(), "create-pilely-app-nosignin-"));
  try {
    generateBaseProject(signInDir, makeOptions(signInDir, true));
    generateSignIn(signInDir, makeOptions(signInDir, true));

    generateBaseProject(noSignInDir, makeOptions(noSignInDir, false));
    // CLI wiring calls generateSignIn only when resolvedOptions.signIn is
    // true -- not called at all here.

    assert.ok(existsSync(join(signInDir, "src/components/SignInButton.tsx")));
    assert.ok(existsSync(join(signInDir, "src/stores/session_store.ts")));
    const signInHomePage = readFileSync(join(signInDir, "src/pages/HomePage.tsx"), "utf8");
    assert.ok(signInHomePage.includes("SignInButton"));
    // sign_in_button.css is written to disk -- it must actually be
    // imported somewhere, or the button ships unstyled dead CSS.
    assert.ok(signInHomePage.includes("sign_in_button.css"));
    const signInPkg = JSON.parse(readFileSync(join(signInDir, "package.json"), "utf8"));
    assert.equal(signInPkg.dependencies.zustand, "^5.0.0");

    assert.ok(!existsSync(join(noSignInDir, "src/components")));
    assert.ok(!existsSync(join(noSignInDir, "src/stores")));
    const noSignInHomePage = readFileSync(join(noSignInDir, "src/pages/HomePage.tsx"), "utf8");
    assert.ok(!noSignInHomePage.includes("SignInButton"));
    const noSignInPkg = JSON.parse(readFileSync(join(noSignInDir, "package.json"), "utf8"));
    assert.ok(!("zustand" in noSignInPkg.dependencies));

    // The flag never touches index.html or the client.js tag.
    const signInHtml = readFileSync(join(signInDir, "index.html"), "utf8");
    const noSignInHtml = readFileSync(join(noSignInDir, "index.html"), "utf8");
    assert.equal(signInHtml, noSignInHtml);
    assert.ok(signInHtml.includes("/~/client.js"));
    assert.ok(noSignInHtml.includes("/~/client.js"));
  } finally {
    rmSync(signInDir, { recursive: true, force: true });
    rmSync(noSignInDir, { recursive: true, force: true });
  }
});
