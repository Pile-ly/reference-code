// The blog's four simple_db tables, as record types, plus the pure
// selectors the screens derive counts and threads with.
//
// Contract points the hooks already handle, worth knowing when reading
// these types:
//
//  1. WRITES NEST, READS ARE FLAT. A write sends the columns; the record
//     comes back with them at the TOP LEVEL, beside `id` and the
//     `_`-prefixed server-minted fields (`DbRecord`).
//  2. LISTS ARE PAGED, newest first. `useRecords` loads one page at a time;
//     any other order is a client sort over the loaded rows.
//  3. EVERY DENIAL IS A UNIFORM 404 — byte-identical to "no such table".
//     Never read a 404 as proof something doesn't exist; UI gates on
//     `usePilelyAuth().user`, never on a status.

import type { DbRecord } from "@pilely/simple-db";

// Columns are all `text`; see build_instruction.md.

export interface PostRecord extends DbRecord {
  title: string;
  subtitle: string;
  body_md: string;
}

/** Same shape as a post — drafts live in their own OWNER-ONLY table, never
 *  as a flag on `posts` (a shared-read table exposes every record). */
export type DraftRecord = PostRecord;

export interface CommentRecord extends DbRecord {
  /** `id` of the `posts` record this comment belongs to. */
  post_id: string;
  body: string;
}

export interface LikeRecord extends DbRecord {
  post_id: string;
}

/** What the editor writes to `posts` / `drafts`. */
export type PostFields = Pick<PostRecord, "title" | "subtitle" | "body_md">;

/** The comments on one post, oldest first (a conversation reads top-down). */
export function commentsFor(comments: CommentRecord[] | undefined, postId: string): CommentRecord[] {
  return (comments ?? [])
    .filter((c) => c.post_id === postId)
    .sort((a, b) => a._created_at_ms - b._created_at_ms);
}

export function likesFor(likes: LikeRecord[] | undefined, postId: string): LikeRecord[] {
  return (likes ?? []).filter((l) => l.post_id === postId);
}

/** Client-side dedupe: has this handle already liked this post? */
export function likedBy(
  likes: LikeRecord[] | undefined,
  postId: string,
  handle: string | null | undefined,
): boolean {
  if (!handle) return false;
  return likesFor(likes, postId).some((l) => l._submitter_handle === handle);
}

/** Drafts, most recently edited first. */
export function byUpdatedDesc<T extends DbRecord>(rows: T[] | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => b._updated_at_ms - a._updated_at_ms);
}
