// Adds the optional "Login with Pilely" affordance on top of the base
// skeleton src/generate_base.js already wrote. Called by the CLI wiring
// only when resolvedOptions.signIn is true, AFTER the base generator has
// run -- this edits src/pages/HomePage.tsx and package.json, both files the
// base generator created.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Copied verbatim from
// reference_code/reusable_components/sign_in_button/SignInButton.tsx, per
// requirement 6: "matching how every reference app carries its own copy".
const SIGN_IN_BUTTON_SOURCE = `// The platform sign-in affordance, in the one form every Pilely app uses.
//
// Three rules are baked in, and they are the whole reason this file exists:
//
//   1. ONE NAME. The label is "Login with Pilely" — every app, every screen,
//      every place a visitor is asked to sign in. Visitors learn what the
//      button is and that their password is only ever typed on the platform,
//      never into an app. Translate it per locale; keep "Pilely" as-is.
//   2. WAIT FOR \`ready\`. \`window.pilely.user()\` only means anything after the
//      runtime resolves \`window.pilely.ready\` — that promise is what consumes
//      a sign-in callback and settles the token. Render nothing until then,
//      or a signed-in visitor watches the button flash on and off.
//   3. GATE ON \`user() === null\`, NEVER ON A STATUS CODE. A public app holds
//      an ANONYMOUS token for signed-out visitors, so a denied write comes
//      back as the uniform 404 — never a 401. Status codes tell you nothing
//      about whether someone is signed in.
//
// Dependency-free on purpose: React and \`window.pilely\`, nothing else. Drop
// it in as-is, or lift the three rules into the session store you already
// have — the reference apps do the latter. See README.md.

import { useEffect, useState, type ReactNode } from "react";

/** The platform-wide label. Translate it; don't rename it per app. */
export const SIGN_IN_LABEL = "Login with Pilely";

export interface SignInButtonProps {
  /**
   * Your own classes. \`sign_in_button.css\` ships the reference look under
   * \`.pilely-signin\`, but the button is meant to wear the app's own button
   * style — copy the behavior, not the skin.
   */
  className?: string;
  /** Translated label, e.g. \`t("nav.signIn")\`. Defaults to the English one. */
  label?: string;
  /** Rendered instead of the button once someone IS signed in. */
  signedIn?: ReactNode;
}

export function SignInButton({
  className = "pilely-signin",
  label = SIGN_IN_LABEL,
  signedIn = null,
}: SignInButtonProps) {
  const [ready, setReady] = useState(false);
  const [signedInNow, setSignedInNow] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const pilely = window.pilely;
      // client.js absent (offline dev, blocked script): the app still works,
      // it is just permanently signed out — so show the button.
      if (!pilely) {
        if (live) setReady(true);
        return;
      }
      await pilely.ready;
      if (!live) return;
      setSignedInNow(pilely.user() !== null);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!ready) return null; // rule 2
  if (signedInNow) return <>{signedIn}</>; // rule 3

  return (
    <button
      type="button"
      className={className}
      onClick={() => void window.pilely?.signIn()}
    >
      {label}
    </button>
  );
}
`;

// Copied verbatim from
// reference_code/reusable_components/sign_in_button/sign_in_button.css.
const SIGN_IN_BUTTON_CSS_SOURCE = `/* The reference look: a pill, the app's ink, one line of text.
 *
 * This is a starting point, not a brand mark — the sign-in button wears the
 * app's own button style, exactly like every other button on the page. What
 * has to stay constant across apps is the NAME on it ("Login with Pilely"),
 * not the skin. An app that already has a \`.btn\` uses that instead and drops
 * this file.
 *
 * Every color reads a theme token with a fallback, so the button inherits an
 * app's palette (light and dark) if one is defined and still looks right when
 * dropped into a page that defines nothing.
 */

.pilely-signin {
  --_ink: var(--ink, #1a1a1a);
  --_on-ink: var(--on-ink, #ffffff);
  --_hairline: var(--hairline, #e8e4de);

  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--_ink);
  border-radius: 999px;
  background: var(--_ink);
  color: var(--_on-ink);
  padding: 7px 16px;
  font: inherit;
  font-size: 13px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}

/* The quieter variant — for a nav bar, where sign-in sits beside other
   controls and shouldn't be the loudest thing on the page. */
.pilely-signin.ghost {
  background: transparent;
  color: var(--_ink);
  border-color: var(--_hairline);
}

.pilely-signin.ghost:hover {
  border-color: var(--_ink);
}

.pilely-signin:focus-visible {
  outline: 2px solid var(--accent, #d4562e);
  outline-offset: 2px;
}

.pilely-signin:disabled {
  opacity: 0.5;
  cursor: default;
}
`;

const SESSION_STORE_SOURCE = `// Who is looking at the page — rehydrated ONCE from the platform client's
// token claims when the SPA mounts (see the rehydrate call in HomePage).
//
// Flow: window.pilely.ready (sign-in callback consumed, if any) →
// window.pilely.user() → this store → every component reads from here.
//
// The rule this store exists to teach: on a PUBLIC app, gate sign-in UI on
// \`user() === null\`, NEVER on a 401. The runtime quietly holds an anonymous
// token for signed-out visitors (that is what lets them read anon_read
// tables), so a denied write comes back as the uniform 404, not a 401 —
// status codes tell you nothing about "is this visitor signed in".

import { create } from "zustand";

export interface SessionUser {
  id: string;
  handle: string;
}

interface SessionState {
  /** False until the client's ready promise resolved and claims were read. */
  ready: boolean;
  /** Null = signed out (including a public app's anonymous token). */
  user: SessionUser | null;
  rehydrate: () => Promise<void>;
  /** Wired to every "Login with Pilely" affordance. Navigates away. */
  signIn: () => void;
  signOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  ready: false,
  user: null,

  rehydrate: async () => {
    const pilely = window.pilely;
    if (!pilely) {
      // client.js failed to load (offline dev, blocked script) — the app
      // still renders, just permanently signed-out.
      set({ ready: true, user: null });
      return;
    }
    await pilely.ready;
    const u = pilely.user();
    const user = u?.id && u.handle ? { id: u.id, handle: u.handle } : null;
    set({ ready: true, user });
  },

  signIn: () => {
    void window.pilely?.signIn();
  },

  signOut: () => {
    window.pilely?.signOut();
    set({ user: null });
  },
}));
`;

const HOME_PAGE_WITH_SIGN_IN_SOURCE = `import { useEffect } from "react";
import { SignInButton } from "../components/SignInButton";
import "../components/sign_in_button.css";
import { useSessionStore } from "../stores/session_store";

export function HomePage() {
  const rehydrate = useSessionStore((s) => s.rehydrate);
  const user = useSessionStore((s) => s.user);

  useEffect(() => {
    void rehydrate();
  }, [rehydrate]);

  return (
    <main>
      <h1>{"Hello World"}</h1>
      <SignInButton signedIn={user ? <span>{user.handle}</span> : null} />
    </main>
  );
}
`;

/**
 * Writes the "Login with Pilely" affordance into `targetDir`, on top of the
 * base skeleton `generateBaseProject` already wrote there.
 * @param {string} targetDir
 * @param {{projectDir: string, services: string[], signIn: boolean, appId: string, install: boolean, json: boolean}} resolvedOptions
 * @returns {{filesWritten: string[]}}
 */
export function generateSignIn(targetDir, resolvedOptions) {
  const filesWritten = [];

  function write(relPath, content) {
    const full = join(targetDir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    filesWritten.push(relPath);
  }

  write("src/components/SignInButton.tsx", SIGN_IN_BUTTON_SOURCE);
  write("src/components/sign_in_button.css", SIGN_IN_BUTTON_CSS_SOURCE);
  write("src/stores/session_store.ts", SESSION_STORE_SOURCE);
  write("src/pages/HomePage.tsx", HOME_PAGE_WITH_SIGN_IN_SOURCE);

  const packageJsonPath = join(targetDir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  pkg.dependencies.zustand = "^5.0.0";
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  filesWritten.push("package.json");

  return { filesWritten };
}
