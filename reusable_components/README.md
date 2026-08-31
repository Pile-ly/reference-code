# Reusable components

Pieces an app **reuses as-is**, rather than patterns an app is built from.

The difference matters when you are deciding what to read. A project in
[`../example_apps/`](../example_apps) answers "how is an app like mine put
together?" — you read it, then write your own. A component here answers
"what does this particular thing look like, and what are its rules?" — you
copy it, keep its behavior, and change as little as you can.

| Component | What it is | When you need it |
|---|---|---|
| [`sign_in_button/`](./sign_in_button) | The **"Login with Pilely"** affordance — component, reference CSS, and a static `preview.html` | Any app with a sign-in gate, which is nearly all of them |
| [`ux_picker_template/`](./ux_picker_template) | The **look picker**: a Vite project that shows an app's screens as devices on a rail, re-skinned through four named looks | Asking the user how their app should look, before you build it |

Apps here don't import from each other or from these — every project in
this repository stays self-contained — so a component is a reference to
copy from, and its behavior is duplicated into each app that needs it.

## What they have in common

Both carry **rules that survive being copied**, and those rules are the
reason they live on their own instead of inside one app:

- The sign-in button has one name across every Pilely app, so a visitor
  recognizes it and knows their password is only ever typed on the
  platform. Its README also carries the two things a hand-rolled gate gets
  wrong: wait for `ready`, and gate on `user() === null` — never on a 401.
- The look picker has one chrome across every Pilely app — the same rail of
  devices, the same dock, the same explainer — so a user who has seen one
  picker knows what to do with the next. Its project structure enforces
  that: the chrome and the four looks are code you don't edit, and adapting
  it means writing screens.

Change the look of either to fit your app. Don't change what makes it
recognizable.
