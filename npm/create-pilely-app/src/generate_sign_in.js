// Adds the optional "Login with Pilely" affordance on top of the base
// skeleton src/generate_base.js already wrote. Called by the CLI wiring
// only when resolvedOptions.signIn is true, AFTER the base generator has
// run -- this replaces src/pages/HomePage.tsx, which the base generator
// created. Auth state comes from the PilelyProvider the base main.tsx
// renders, so no dependency is added to package.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The platform sign-in affordance: the name, label, props and css of
// reusable_components/sign_in_button/SignInButton.tsx, with its auth state
// read from usePilelyAuth() -- PilelyProvider (src/main.tsx) owns the wait
// for `ready` and the re-read of user() after an in-place sign-in.
const SIGN_IN_BUTTON_SOURCE = `// The platform sign-in affordance, in the one form every Pilely app uses.
//
// Three rules are baked in:
//
//   1. ONE NAME. The label is "Login with Pilely" — every app, every screen,
//      every place a visitor is asked to sign in. Visitors learn what the
//      button is and that their password is only ever typed on the platform,
//      never into an app. Translate it per locale; keep "Pilely" as-is.
//   2. WAIT FOR \`ready\`. \`usePilelyAuth().user\` only means anything once
//      \`ready\` is true — that is when the runtime has consumed any sign-in
//      callback. Render nothing until then, or a signed-in visitor watches
//      the button flash on and off.
//   3. GATE ON \`user === null\`, NEVER ON A STATUS CODE. A public app holds
//      an ANONYMOUS token for signed-out visitors, so a denied write comes
//      back as the uniform 404 — never a 401. Status codes tell you nothing
//      about whether someone is signed in.
//
// <PilelyProvider> (src/main.tsx) owns the auth state: it waits for the
// runtime, reads the user, and updates it after signIn() / signOut(), so
// this button only renders what usePilelyAuth() says.

import { useEffect, useRef, type ReactNode } from "react";
import { usePilelyAuth } from "@pilely/core";

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
  /**
   * Called when a click signed someone in without leaving the page (mock
   * mode does; the real runtime navigates away first).
   */
  onSignedIn?: () => void;
}

export function SignInButton({
  className = "pilely-signin",
  label = SIGN_IN_LABEL,
  signedIn = null,
  onSignedIn,
}: SignInButtonProps) {
  const { ready, user, signIn } = usePilelyAuth();
  // Set by a click, cleared once that click's sign-in shows up in \`user\`.
  const clicked = useRef(false);

  useEffect(() => {
    if (clicked.current && user !== null) {
      clicked.current = false;
      onSignedIn?.();
    }
  }, [user, onSignedIn]);

  if (!ready) return null; // rule 2
  if (user !== null) return <>{signedIn}</>; // rule 3

  const handleClick = async () => {
    clicked.current = true;
    try {
      await signIn();
    } catch {
      clicked.current = false;
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={() => void handleClick()}
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

// The handle shows through <SignedIn>, which renders only once the runtime is
// ready and someone is signed in; the button renders only while signed out.
const HOME_PAGE_WITH_SIGN_IN_SOURCE = `import { SignedIn, usePilelyAuth } from "@pilely/core";
import { SignInButton } from "../components/SignInButton";
import "../components/sign_in_button.css";

export function HomePage() {
  const { user } = usePilelyAuth();

  return (
    <main>
      <h1>{"Hello World"}</h1>
      <SignInButton />
      <SignedIn>
        <span>{user?.handle}</span>
      </SignedIn>
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
  write("src/pages/HomePage.tsx", HOME_PAGE_WITH_SIGN_IN_SOURCE);

  return { filesWritten };
}
