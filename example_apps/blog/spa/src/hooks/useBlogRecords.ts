// One read per table, shared by every screen that shows it. Each call
// below is the same query key wherever it is used, so the home feed, the
// post page and the like button read one cache entry, and every write
// through the simple-db mutation hooks refreshes it.
//
// Lists ask for the service's page cap (100) and expose `hasNextPage` /
// `fetchNextPage` for a More control; the service answers newest first.

import { useRecords } from "@pilely/simple-db";
import type { CommentRecord, DraftRecord, LikeRecord, PostRecord } from "../lib/records";

const PAGE = 100;

export function usePosts() {
  return useRecords<PostRecord>("posts", { limit: PAGE });
}

/** Every comment, across posts — the home feed's counts. */
export function useComments() {
  return useRecords<CommentRecord>("comments", { limit: PAGE });
}

/** Every like, across posts — the home feed's counts. */
export function useLikes() {
  return useRecords<LikeRecord>("likes", { limit: PAGE });
}

/** One post's comments, filtered server-side with `eq`. */
export function usePostComments(postId: string) {
  return useRecords<CommentRecord>("comments", { eq: { post_id: postId }, limit: PAGE });
}

/** One post's likes, filtered server-side with `eq`. */
export function usePostLikes(postId: string) {
  return useRecords<LikeRecord>("likes", { eq: { post_id: postId }, limit: PAGE });
}

/** The owner-only drafts table. Mount only for the owner: anyone else's
 *  read is the uniform 404. */
export function useDrafts() {
  return useRecords<DraftRecord>("drafts", { limit: PAGE });
}
