// All blog content, in one store the pages share.
//
// Data flow: `loadHome()` pulls the three public tables in full (posts +
// comments + likes — each a cursor-walked `records/list`) and every screen
// derives from those arrays: the feed sorts posts, a post page filters its
// comments/likes, counts are `.length`. Mutations write through simple_db
// first and then patch the local arrays with the server's answer — the
// server-minted fields (`id`, `_submitter_handle`, `_created_at_ms`) only
// exist on the returned record, so local echo without the round trip is
// never correct.
//
// Full-table pulls are the right call at a personal blog's scale and keep
// the code honest about paging (listAll walks the cursor). An app expecting
// thousands of rows per table would filter server-side with `eq` per post
// instead — see the simple_db manual's note on `eq` vs client filtering.

import { create } from "zustand";
import {
  type CommentRecord,
  type DraftRecord,
  type LikeRecord,
  type PostRecord,
  SimpleDb,
} from "../lib/db";

// A `type` (not an interface) so it gets TypeScript's implicit index
// signature and flows straight into SimpleDb's `Record<string, string>`.
type DraftInput = {
  title: string;
  subtitle: string;
  body_md: string;
};

interface BlogState {
  /** Published posts, newest first. Null = not loaded yet. */
  posts: PostRecord[] | null;
  /** ALL comments / likes across posts (public tables, modest scale). */
  comments: CommentRecord[] | null;
  likes: LikeRecord[] | null;
  /** Owner-only table; non-owners never load this (UI-gated). */
  drafts: DraftRecord[] | null;
  loadingHome: boolean;
  homeError: string | null;

  loadHome: (force?: boolean) => Promise<void>;
  /** The post for a detail page — from the loaded feed, else a single get
   *  (deep link into a not-yet-loaded app). */
  ensurePost: (id: string) => Promise<PostRecord | null>;

  addComment: (postId: string, body: string) => Promise<void>;
  /** Create-only — there is no un-like (users cannot delete records), so the
   *  caller checks `likedBy` first and the UI never pretends otherwise. */
  likePost: (postId: string) => Promise<void>;
  removeComment: (commentId: string) => Promise<void>;

  loadDrafts: (force?: boolean) => Promise<void>;
  saveDraft: (id: string | null, input: DraftInput) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;
  /** Publish = create in `posts` + delete the draft (locked design). */
  publishDraft: (draftId: string | null, input: DraftInput) => Promise<string>;
  /** Editing a published post = owner record update. */
  updatePost: (postId: string, input: DraftInput) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
}

export const useBlogStore = create<BlogState>((set, get) => ({
  posts: null,
  comments: null,
  likes: null,
  drafts: null,
  loadingHome: false,
  homeError: null,

  loadHome: async (force = false) => {
    const { posts, loadingHome } = get();
    if (loadingHome || (posts !== null && !force)) return;
    set({ loadingHome: true, homeError: null });
    try {
      // Three independent tables — fetch concurrently.
      const [postRows, commentRows, likeRows] = await Promise.all([
        SimpleDb.listAll<PostRecord>("posts"),
        SimpleDb.listAll<CommentRecord>("comments"),
        SimpleDb.listAll<LikeRecord>("likes"),
      ]);
      postRows.sort((a, b) => b._created_at_ms - a._created_at_ms);
      set({
        posts: postRows,
        comments: commentRows,
        likes: likeRows,
        loadingHome: false,
      });
    } catch (e) {
      set({ loadingHome: false, homeError: e instanceof Error ? e.message : String(e) });
    }
  },

  ensurePost: async (id) => {
    await get().loadHome();
    const fromFeed = get().posts?.find((p) => p.id === id);
    if (fromFeed) return fromFeed;
    try {
      return await SimpleDb.get<PostRecord>("posts", id);
    } catch {
      // Uniform 404: genuinely missing OR denied — either way, "not found"
      // is the only honest thing a public post page can render.
      return null;
    }
  },

  addComment: async (postId, body) => {
    const record = await SimpleDb.create<CommentRecord>("comments", {
      post_id: postId,
      body,
    });
    set((s) => ({ comments: [...(s.comments ?? []), record] }));
  },

  likePost: async (postId) => {
    const record = await SimpleDb.create<LikeRecord>("likes", { post_id: postId });
    set((s) => ({ likes: [...(s.likes ?? []), record] }));
  },

  removeComment: async (commentId) => {
    await SimpleDb.remove("comments", commentId);
    set((s) => ({ comments: (s.comments ?? []).filter((c) => c.id !== commentId) }));
  },

  loadDrafts: async (force = false) => {
    if (get().drafts !== null && !force) return;
    const rows = await SimpleDb.listAll<DraftRecord>("drafts");
    rows.sort((a, b) => b._updated_at_ms - a._updated_at_ms);
    set({ drafts: rows });
  },

  saveDraft: async (id, input) => {
    const record = id
      ? await SimpleDb.update<DraftRecord>("drafts", id, input)
      : await SimpleDb.create<DraftRecord>("drafts", input);
    set((s) => ({
      drafts: [record, ...(s.drafts ?? []).filter((d) => d.id !== record.id)],
    }));
  },

  deleteDraft: async (id) => {
    await SimpleDb.remove("drafts", id);
    set((s) => ({ drafts: (s.drafts ?? []).filter((d) => d.id !== id) }));
  },

  publishDraft: async (draftId, input) => {
    // Create first, delete after — failing halfway leaves the draft intact
    // (a duplicate is recoverable; a lost draft is not).
    const post = await SimpleDb.create<PostRecord>("posts", input);
    set((s) => ({ posts: [post, ...(s.posts ?? [])] }));
    if (draftId) await get().deleteDraft(draftId);
    return post.id;
  },

  updatePost: async (postId, input) => {
    const record = await SimpleDb.update<PostRecord>("posts", postId, input);
    set((s) => ({
      posts: (s.posts ?? []).map((p) => (p.id === postId ? record : p)),
    }));
  },

  deletePost: async (postId) => {
    await SimpleDb.remove("posts", postId);
    // Its comments/likes stay in their tables but are unreachable once the
    // post is gone — acceptable orphaning at blog scale; an owner who wants
    // them gone can delete them from the simple_db UI.
    set((s) => ({ posts: (s.posts ?? []).filter((p) => p.id !== postId) }));
  },
}));

// ── Pure selectors (used with useBlogStore(...) or on a snapshot) ──

export function commentsFor(comments: CommentRecord[] | null, postId: string): CommentRecord[] {
  return (comments ?? [])
    .filter((c) => c.post_id === postId)
    .sort((a, b) => a._created_at_ms - b._created_at_ms);
}

export function likesFor(likes: LikeRecord[] | null, postId: string): LikeRecord[] {
  return (likes ?? []).filter((l) => l.post_id === postId);
}

/** Client-side dedupe: has this handle already liked this post? */
export function likedBy(
  likes: LikeRecord[] | null,
  postId: string,
  handle: string | null,
): boolean {
  if (!handle) return false;
  return likesFor(likes, postId).some((l) => l._submitter_handle === handle);
}
