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
    assert.ok(!existsSync(join(signInDir, "src/stores")), "no session store is generated");
    const signInHomePage = readFileSync(join(signInDir, "src/pages/HomePage.tsx"), "utf8");
    assert.ok(signInHomePage.includes("SignInButton"));
    // sign_in_button.css is written to disk -- it must actually be
    // imported somewhere, or the button ships unstyled dead CSS.
    assert.ok(signInHomePage.includes("sign_in_button.css"));
    // Auth state lives in PilelyProvider: --sign-in adds no dependency.
    const signInPkg = JSON.parse(readFileSync(join(signInDir, "package.json"), "utf8"));
    assert.ok(!("zustand" in signInPkg.dependencies));
    const noSignInDeps = JSON.parse(readFileSync(join(noSignInDir, "package.json"), "utf8")).dependencies;
    assert.deepEqual(signInPkg.dependencies, noSignInDeps);

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

test("the sign-in button and home page read auth from usePilelyAuth, not window.pilely", () => {
  const targetDir = mkdtempSync(join(tmpdir(), "create-pilely-app-signin-hooks-"));
  try {
    generateBaseProject(targetDir, makeOptions(targetDir, true));
    generateSignIn(targetDir, makeOptions(targetDir, true));

    const button = readFileSync(join(targetDir, "src/components/SignInButton.tsx"), "utf8");
    assert.ok(button.includes('import { usePilelyAuth } from "@pilely/core";'));
    assert.ok(button.includes("const { ready, user, signIn } = usePilelyAuth();"));
    assert.ok(!button.includes("window.pilely"), "the button never reads the runtime directly");
    assert.ok(!button.includes("pilely.ready"));
    // Same name, label and props.
    assert.ok(button.includes("export function SignInButton("));
    assert.ok(button.includes('export const SIGN_IN_LABEL = "Login with Pilely";'));
    for (const prop of ["className?: string;", "label?: string;", "signedIn?: ReactNode;", "onSignedIn?: () => void;"]) {
      assert.ok(button.includes(prop), prop);
    }
    assert.ok(button.includes('className = "pilely-signin"'));
    assert.match(button, /if \(!ready\) return null;/);
    assert.match(button, /if \(user !== null\) return <>\{signedIn\}<\/>;/);

    const css = readFileSync(join(targetDir, "src/components/sign_in_button.css"), "utf8");
    assert.ok(css.includes(".pilely-signin {"));

    // The handle shows through <SignedIn>; no store, no rehydrate effect.
    const homePage = readFileSync(join(targetDir, "src/pages/HomePage.tsx"), "utf8");
    assert.ok(homePage.includes('import { SignedIn, usePilelyAuth } from "@pilely/core";'));
    assert.match(homePage, /<SignedIn>\s*<span>\{user\?\.handle\}<\/span>\s*<\/SignedIn>/);
    assert.ok(!homePage.includes("useEffect"));
    assert.ok(!homePage.includes("session_store"));
    assert.ok(!homePage.includes("rehydrate"));

    // The provider wraps the router with or without --sign-in.
    const mainTsx = readFileSync(join(targetDir, "src/main.tsx"), "utf8");
    assert.ok(mainTsx.includes("<PilelyProvider>"));
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});
