# `@pilely/core`

A typed facade over the platform's `client.js` auth runtime, not a second
runtime. `core` never reimplements any part of the sign-in dance — no PKCE,
no state nonce, no mint dance, no token storage, no `spa_ticket` logic, no
re-mint cooldown — for three reasons that hold regardless of how tempting an
offline, bundle-only version of this looks:

1. **The bootstrap page makes it impossible.** The entire page a gated app
   serves to a signed-out visitor is a handful of lines: one meta tag and
   one script pointing at `/~/client.js`. No app bundle runs there yet — and
   the bundle an npm package lives in is exactly what is withheld until the
   sign-in gate opens.
2. **Boot ordering.** `client.js` runs at parse time and, before any app
   code, consumes the sign-in callback and attempts an anonymous mint.
   `ready()` below is the promise that this has settled. Code that ships
   inside an app bundle has already missed that window.
3. **Fix latency.** Served unversioned from the apex, a fix to `client.js`
   reaches every deployed app on its next load. Shipped through npm, a fix
   reaches only apps whose authors bump, rebuild and republish — and not
   every author will. `client.js` holds exactly the code that cannot
   tolerate that kind of long tail: the sign-in callback check, and the
   cooldown that is the only thing standing between a stale token and an
   invisible redirect loop.

## What this package adds

Everything here is what today gets hand-copied into every app instead:

- The `window.pilely` type declaration (`PilelyClient`, `PilelyClaims`,
  `PilelyUser`). The `Window` augmentation applies wherever this package is
  imported.
- `serviceOrigin(service)` — derives a managed service's origin from the
  apex `client.js` was actually loaded from, never a baked-in
  `pilely.app`. That is what keeps a bundle portable to a self-hosted
  instance.
- `appId()` — reads the app id declared by `<meta name="pilely-app">` and
  throws an actionable error when it is missing.
- `ready()` — await this before any data call. Skipping it races the
  boot-time anonymous mint on a public app: the call goes out tokenless,
  the service answers 401, and `client.js` reads a tokenless 401 as an
  *expired user token* and bounces a signed-out visitor to the login page.
- `PilelyError` — one error type, normalizing both denial shapes a
  `simple_*` service can answer with. **Gate UI on `user() === null`, never
  on a status** — a denied write on a public app comes back as a uniform
  404, not a 401.
- `call()` — the one HTTP transport every `@pilely/simple-*` package goes
  through, and the escape hatch for a route no wrapper covers yet. Never
  hand-roll a `fetch` next to it: that is how a token reaches the wrong
  origin, and separately how an uploaded blob can bind to nothing.
- `collectPages()` — the cursor-walk loop shared by every paged listing
  route, written by hand in every app today.
- `assertPilelyRuntime()` — a development-only check, never a module side
  effect (this package sets `"sideEffects": false`). Call it explicitly to
  confirm `window.pilely` is present and that `<meta name="pilely-app">`
  sits **above** the `client.js` script tag — a real, silent footgun,
  because `client.js` reads that tag at parse time.

Deliberately absent: no wrapper for `user()`, `claims()`, `token()`,
`signIn()`, `signOut()`, `takeReturnPath()` or `isAppOrigin()`. An app reads
those directly off `window.pilely`, which this package's type declaration
already makes typed and safe.

## Install

```sh
npm install @pilely/core
```

Always install with the scope — `pilely-core` and similar unscoped names are
not owned by this project and are squattable.

This is a pre-1.0 package and moves with the platform. Nothing here is
published to the registry yet. Zero runtime dependencies, no framework.

## Known gap

The ordering `assertPilelyRuntime()` enforces — the `pilely-app` meta tag
above the `client.js` script tag — is not written into the platform's own
SPA build standard. This assertion is presently the only enforcement of
that rule.
