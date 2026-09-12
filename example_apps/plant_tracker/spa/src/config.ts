// ─── The one place a copier edits ───────────────────────────────────────
//
// Everything deployment-specific about this tracker lives here (plus the
// `<meta name="pilely-app">` tag in index.html — see build_instruction.md).
// Nothing else in src/ needs to change to make this app yours.

/**
 * The empty group's 22-char nanoid — REPLACE with the one
 * `simple-group/groups/create` returned (build_instruction.md step 2).
 *
 * This is the one deployment value the FRONT-END needs that the blog
 * reference app didn't: every photo upload names a `read_group` in the
 * `simple-blob/upload` request body, and this app scopes every blob to the
 * same memberless group its two tables use (the "only me" idiom — the
 * owner passes every check regardless of membership, everyone else is
 * denied). A bundle shipped with the placeholder uploads nothing —
 * simple_blob rejects an unknown group with a 400 — while everything else
 * looks fine; the same "nothing looks wrong until someone tries" trap as
 * the pile id.
 */
export const READ_GROUP = "REPLACE_WITH_YOUR_EMPTY_GROUP_NANOID";

/** The tracker's title — sample branding, make it yours. Shown in the nav
 *  brand and as the document title. */
export const APP_TITLE = "Waterly";

// Unlike the blog there is NO owner-handle setting here. On a private app
// every visitor who can read data IS the owner — the server enforces that
// with uniform 404s for everyone else — so there is no owner-vs-visitor UI
// split for a handle to drive. The nav shows whoever is signed in, straight
// from `window.pilely.user()`.
