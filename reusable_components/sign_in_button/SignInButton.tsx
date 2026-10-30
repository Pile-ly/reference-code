// The platform sign-in affordance, in the one form every Pilely app uses.
//
// Three rules are baked in, and they are the whole reason this file exists:
//
//   1. ONE NAME. The label is "Login with Pilely" — every app, every screen,
//      every place a visitor is asked to sign in. Visitors learn what the
//      button is and that their password is only ever typed on the platform,
//      never into an app. Translate it per locale; keep "Pilely" as-is.
//   2. WAIT FOR `ready`. `window.pilely.user()` only means anything after the
//      runtime resolves `window.pilely.ready` — that promise is what consumes
//      a sign-in callback and settles the token. Render nothing until then,
//      or a signed-in visitor watches the button flash on and off.
//   3. GATE ON `user() === null`, NEVER ON A STATUS CODE. A public app holds
//      an ANONYMOUS token for signed-out visitors, so a denied write comes
//      back as the uniform 404 — never a 401. Status codes tell you nothing
//      about whether someone is signed in.
//
// Dependency-free on purpose: React and `window.pilely`, nothing else. Drop
// it in as-is, or lift the three rules into the session store you already
// have — the reference apps do the latter. See README.md.

import { useEffect, useState, type ReactNode } from "react";

/** The platform-wide label. Translate it; don't rename it per app. */
export const SIGN_IN_LABEL = "Login with Pilely";

export interface SignInButtonProps {
  /**
   * Your own classes. `sign_in_button.css` ships the reference look under
   * `.pilely-signin`, but the button is meant to wear the app's own button
   * style — copy the behavior, not the skin.
   */
  className?: string;
  /** Translated label, e.g. `t("nav.signIn")`. Defaults to the English one. */
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
