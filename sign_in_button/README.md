# sign_in_button

The one affordance every Pilely app shares: **"Login with Pilely"**.

Not an app — a single component, plus a look reference, so you can see
exactly what the sign-in button is before you build one. Every other
project in this repo ships its own copy of this behavior wired into its
own nav; this folder is that behavior on its own, with the reasoning
attached.

```
sign_in_button/
├── SignInButton.tsx      the component — React + window.pilely, nothing else
├── pilely.d.ts           just enough runtime types to typecheck standalone
├── sign_in_button.css    the reference look (a pill; solid + ghost variants)
└── preview.html          open in a browser to SEE it — both themes, all states
```

Open `preview.html` **from this folder** — it loads `sign_in_button.css`
from alongside it, so a copy fetched on its own renders unstyled. Nothing on
the page talks to the platform; it is a static look reference, so the
buttons there don't sign anyone in.

## The rule

Wherever your app asks a visitor to sign in — to save, to upload, to see
anything personal — the affordance is labeled **"Login with Pilely"** and
wired to `window.pilely.signIn()`.

One recognizable name across every app is part of the platform's auth
model, not a style preference. Visitors learn what the button is, and they
learn that their password is only ever typed on the platform, never into
an app. "Sign in with Pilely", "Log in", "Get started", a bare avatar icon
— each one costs a visitor that recognition.

Translate the label per locale; keep **Pilely** as-is. On a self-hosted
instance, substitute that instance's name.

The *look* is yours. The button should wear the app's own button style
like every other button on the page — `sign_in_button.css` is a starting
point, not a brand mark. What stays constant across apps is the name on it.

## The three rules in the code

1. **One name.** `SIGN_IN_LABEL` is the platform-wide string. Pass a
   translated `label` per locale; don't rename it per app.
2. **Wait for `ready`.** `window.pilely.user()` only means something after
   `window.pilely.ready` resolves — that promise is what consumes a sign-in
   callback and settles the token. Render nothing until then, or a
   signed-in visitor watches the button flash on and off.
3. **Gate on `user() === null`, never on a status code.** A public app
   holds an *anonymous* token for signed-out visitors, so a denied write
   comes back as the uniform 404 — never a 401. Status codes say nothing
   about whether someone is signed in. This is the single most common way
   a hand-rolled sign-in gate goes wrong.

## Using it

Drop `SignInButton.tsx` into your components folder. It needs React and the
platform runtime — the `client.js` script tag your `index.html` already
carries per the [SPA standard](https://pilely.app/skill/standards/spa).
If your app already declares `window.pilely` (every app in this repo does,
in `vite-env.d.ts`), delete `pilely.d.ts`.

```tsx
import { useTranslation } from "react-i18next";
import { SignInButton } from "./components/SignInButton";

function Nav() {
  const { t } = useTranslation();
  return (
    <nav>
      <span>My app</span>
      <SignInButton
        className="btn btn-ghost"
        label={t("nav.signIn")}
        signedIn={<UserMenu />}
      />
    </nav>
  );
}
```

`className` is your own button style, `label` is the translated
"Login with Pilely", and `signedIn` is whatever replaces the button once
someone is signed in — an avatar, a handle, a menu. Omit `signedIn` and the
button simply disappears.

Keep the string in your locale files, not in JSX — the standard key across
this repo is `nav.signIn`:

```json
{ "nav": { "signIn": "Login with Pilely" } }
```

## Or lift the rules instead

Most real apps read identity from a session store rather than resolving
`window.pilely.ready` in each component, because plenty of other things on
the page need to know who is there. That is what every app in this repo
does — see any of their `spa/src/stores/session_store.ts`, and the nav that
consumes it:

- [`blog/`](../blog) — public app, three-way nav (signed out / reader / owner)
- [`plant_tracker/`](../plant_tracker) — private app, whole-page sign-in gate
- [`storefront/`](../storefront) — sign-in-gated form on a public site
- [`event_rsvp/`](../event_rsvp) — public reads, signed-in writes

If you go that route, this component is still the reference for *what* to
build: the same three rules apply, they just live in the store instead.

## Read next

- [The auth model](https://pilely.app/skill/build_app/reference) — why an
  app never builds its own accounts, and where this button fits.
- [SPA standard](https://pilely.app/skill/standards/spa) — the `client.js`
  contract, `window.pilely`, and the meta tag that names your app.
