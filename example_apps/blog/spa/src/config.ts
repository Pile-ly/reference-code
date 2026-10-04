// ─── The one place a copier edits ───────────────────────────────────────
//
// Everything deployment-specific about this blog lives here (plus the
// `<meta name="pilely-app">` tag in index.html — see build_instruction.md).
// Nothing else in src/ needs to change to make this app yours.

/**
 * The blog owner's Pilely handle — REPLACE the fallback with your own (no
 * `@`), or set `VITE_OWNER_HANDLE` at build time. `.env.mock` sets it to
 * the mock runtime's `mock_user`, so signing in under `npm run dev:mock`
 * makes you the owner.
 *
 * All owner-only UI (New post, Drafts, Edit/Delete, comment moderation)
 * gates on `usePilelyAuth().user?.handle === OWNER_HANDLE` (see
 * `hooks/useIsOwner.ts`). This is a UI convenience only: simple_db
 * enforces the real permissions server-side (update/delete is the DB
 * owner's alone; `drafts` is behind an empty group), so a wrong value here
 * can hide or show buttons, never grant access.
 */
export const OWNER_HANDLE: string =
  import.meta.env.VITE_OWNER_HANDLE || "your_handle_here";

/** The blog's masthead title — sample branding, make it yours. */
export const BLOG_TITLE = "Little Manhattan";

/** The masthead tagline shown under the title. */
export const BLOG_TAGLINE = "Notes on building small software";
