// ─── The one place a copier edits ───────────────────────────────────────
//
// Everything host-specific about this app lives here: who owns it and how
// the club presents itself. Turning "Sunset Supper Club" into your own
// series — a book club, a run club, a supper club — is an edit to THIS
// file, plus the two deployment steps in build_instruction.md (the
// `pile_id` meta in index.html, and public/index.md — the same
// description, but for AI agents). Nothing else in src/ names the club.
//
// The events themselves are DATA, not config: the owner creates them in
// the app at /admin and they live in simple_db. That is the difference
// between this app and the storefront reference, whose content is baked
// into the bundle.
//
// Note what is NOT here: the empty group's nanoid. Unlike the plant
// tracker — where every photo upload names a read group, so the group
// ships in the bundle — this app's covers are PUBLIC blobs
// (`read_group: null` + `anon_read: true`), so the empty group is used
// only server-side, when the tables are created. Two placeholders total.

/**
 * The host's Pilely handle — REPLACE with your own (no `@`). Your
 * session's handle is in the login skill's `/~/me` answer.
 *
 * All owner-only UI (the "Host portal" link, /admin) gates on
 * `window.pilely.user()?.handle === OWNER_HANDLE`. This is a UI
 * convenience only: simple_db enforces the real permissions server-side
 * (`events` is written only by the empty write group, `rsvps` is read
 * only by the empty read group — both owner-only by construction), so a
 * wrong value here can hide or reveal a page, never the data.
 */
export const OWNER_HANDLE = "your_handle_here";

/** How the club introduces itself: the nav wordmark, the home page's host
 *  header, and the document title. */
export const HOST = {
  name: "Sunset Supper Club",
  /** One line under the name on the home page. */
  tagline: "Occasional dinners and picnics",
  /** The character in the brand dot and the host avatar. */
  mark: "☀",
};

/** Field bounds the UI enforces. `party` matches the UX spec's stepper;
 *  the text caps keep a record comfortably under simple_db's ~16 KB
 *  serialized-fields limit and are surfaced in the UI, never silent. */
export const LIMITS = {
  partyMin: 1,
  partyMax: 12,
  /** RSVP note to the host. */
  noteMax: 280,
  titleMax: 120,
  placeMax: 160,
  descriptionMax: 2000,
};
