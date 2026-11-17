# `@pilely/simple-limiter`

The pilely.app bot check, in the browser. When an app's owner puts a **challenge policy** on a route (for example `records/create` on a table signed-out visitors write to), root refuses every matching call that does not carry a solved proof-of-work challenge. This package gets one and solves it; the app sends the answer with the one call that needs it.

It has exactly two functions and no hooks. The challenge policies themselves are HTTP routes an owner or their agent calls directly: [`https://simple-limiter.pilely.app/README.md`](https://simple-limiter.pilely.app/README.md) (`POST /challenge_policies/create`, `/list`, `/{id}/disable`).

| Function | Does | Returns |
| --- | --- | --- |
| `getChallenge()` | `POST https://simple-limiter.pilely.app/challenge` with the page's token | `Promise<Challenge>`: `{ algorithm, challenge, maxnumber, salt, signature }` |
| `solveChallenge(challenge)` | solves it in the page, showing the corner badge | `Promise<string>`: the answer, ready to send as `X-Pilely-Challenge` |

## Getting, solving and sending an answer

```tsx
import { getChallenge, solveChallenge } from "@pilely/simple-limiter";
import { useCreateRecord } from "@pilely/simple-db";

// Every create gets, solves and sends a fresh answer.
const signUp = useCreateRecord<Signup>("signups", {
  challenge: async () => solveChallenge(await getChallenge()),
});

async function onSubmit(email: string) {
  await signUp.mutateAsync({ email });
}
```

- **Pass the answer as `{ challenge }`.** Every hook of `@pilely/simple-db`, `@pilely/simple-email` and `@pilely/simple-group`, and `@pilely/core`'s `call()`, takes a `challenge` option and sends it as the `X-Pilely-Challenge` request header. It is the answer string, or a function answering one, asked once for each request the hook sends — the form above, so each call carries a fresh answer. `undefined` sends no header.
- **One answer works for one call**, made through the same app, within 5 minutes of `getChallenge()`. Root marks it used. Get it when the app is about to make the call (the visitor submits the form), not at page load.
- **Only a matching call uses it up.** On a call no challenge policy matches, root ignores the header. Root removes it before forwarding, so neither the service nor the app's own backend ever sees it.
- **Any page token works.** A signed-in user's token, or the anonymous token `client.js` mints for a signed-out visitor, both get a challenge bound to the app the page belongs to. `getChallenge()` waits for `window.pilely.ready` like every other call.

`call()` takes the answer the same way, for any route — here a simple_email template send:

```ts
import { call } from "@pilely/core";

const answer = await solveChallenge(await getChallenge());
await call({ service: "simple-email", path: `/accounts/${appId}/templates/${templateId}/send`, body: variables, challenge: answer });
```

## When root refuses a call

A call a challenge policy matches fails with a `PilelyError`, like any other refusal, in the error-code union of the package that made it (`SimpleDbErrorCode`, `SimpleEmailErrorCode`, ...):

| Code | Status | Means |
| --- | --- | --- |
| `challenge_required` | 403 | the call carried no answer |
| `challenge_failed` | 403 | the answer was malformed, its hash or signature was wrong, it expired (5 minutes after `getChallenge()`), it was started through another app, or an earlier call already used it |

Nothing reached the service either way. A 4xx is never retried, so an answer is never sent twice. What the app does next is its own call: to try again, **start over with a new puzzle** — call `getChallenge()` and `solveChallenge()` again (a function `challenge` option does that on the next attempt by itself) — and resend the call. The owner's own calls, and the app's server's, are challenged too: a policy targets an endpoint, not a kind of caller.

## The corner badge

A visitor always sees that a check ran. While `solveChallenge()` solves, a small badge in the bottom-right corner of the page says **"Verifying you're human…"** with a spinner; when it is solved it says **"Verified ✓"** for about a second and a half, then fades out. If the solve fails the badge is removed at once.

- Plain DOM: one `<div id="pilely-challenge-badge" role="status">` appended to `<body>`, and one `<style id="pilely-challenge-badge-style">` injected the first time. It ignores pointer events, follows `prefers-color-scheme`, and slows its spinner under `prefers-reduced-motion`. No web component, no `<altcha-widget>`.
- Solves that overlap share the one badge; it says "Verified ✓" when the last of them finishes.
- Where there is no `document` (node, a worker) no badge is drawn and the solver runs the same.

## How the puzzle works

The challenge is the open-source [ALTCHA](https://altcha.org) proof of work, v1 format. The platform picks a secret number from 0 to `maxnumber` and hands out `challenge`, the lowercase hex SHA-256 of `salt` followed by that number in decimal, signed with a platform key. The salt carries the challenge's expiry and its app (`<random hex>?expires=<unix seconds>&app=<app id>&`, the two params in either order; treat the salt as opaque), so nothing is stored when it is handed out. `solveChallenge()` tries 0, 1, 2, ... until the hash matches, and answers standard base64 of the JSON `{"algorithm", "challenge", "number", "salt", "signature"}` — the four strings exactly as issued, plus the number.

The difficulty is one platform value (`maxnumber` 100000). The solver hashes in plain TypeScript — the salt's whole blocks once, then only each candidate's tail — and yields to the page every 16 ms, so the page stays responsive. A worst-case solve (the number at `maxnumber`) took about 25 ms in desktop Chrome, and about 90 ms and 145 ms with Chrome's CPU throttled 4x and 6x, the usual stand-ins for a mid-range and a low-end phone.

`solveChallenge()` throws a `PilelyError` with code `challenge_unsolvable` (status `0`) when the challenge is not one it can solve — another algorithm, a malformed field — or no number up to `maxnumber` solves it. Get a new challenge.

## Error codes

`getChallenge()` and `solveChallenge()` throw `PilelyError`, with a `code` from `SimpleLimiterErrorCode`:

| Code | Status | Means |
| --- | --- | --- |
| `login_required` | 401 | root's: the call carried no token. Call after `ready`, on an app page whose `client.js` has a token (the anonymous one included) |
| `not_found` | 404 | the uniform hide: an agent's token gets no challenge |
| `bad_request` | 400 | the request body was not empty or a JSON object (`getChallenge()` always sends `{}`) |
| `bad_forwarded_identity` | 401 | the forwarded identity did not verify |
| `internal_error` | 500 | the challenge could not be created; retry |
| `challenge_unsolvable` | `0` | minted by this package, never the service: the challenge could not be solved; get a new one |

## Mock mode

Built with `VITE_PILELY_MOCK=1`, `getChallenge()` answers from an in-memory fake: a fresh challenge at the platform's difficulty, bound to the mock app and expiring in 5 minutes, which `solveChallenge()` solves like a real one, badge included. Its signature is not the platform's, and nothing checks it: every mock-mode fake ignores `{ challenge }`, so a challenged call works in mock mode with or without an answer. See [`@pilely/core`](../core#mock-mode) for the switch.

## Install

```sh
npm install @pilely/simple-limiter @pilely/core
```

`@pilely/core` (`^0.4.4`, the version whose `call()` sends `challenge`) is a peer dependency, with its own peers `react` and `@tanstack/react-query`. Pass the answer to `@pilely/simple-db` `0.8.1`, `@pilely/simple-email` `0.4.5` or `@pilely/simple-group` `0.7.1` or later. Always install with the scope — unscoped names like `pilely-limiter` are not owned by this project. This is a pre-1.0 package and moves with the platform.
