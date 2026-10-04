import { useCreateRecord, useDeleteRecord } from "@pilely/simple-db";
import type { PostFields, PostRecord } from "../lib/records";

/**
 * Publish = create in `posts`, THEN delete the draft (when there is one),
 * as two sequential writes: failing halfway leaves the draft intact — a
 * duplicate post is recoverable, a lost draft is not. Resolves with the new
 * post's server id.
 */
export function usePublishDraft(): (draftId: string | null, fields: PostFields) => Promise<string> {
  const createPost = useCreateRecord<PostRecord>("posts");
  const deleteDraft = useDeleteRecord("drafts");
  return async (draftId, fields) => {
    const post = await createPost.mutateAsync(fields);
    if (draftId) await deleteDraft.mutateAsync(draftId);
    return post.id;
  };
}
