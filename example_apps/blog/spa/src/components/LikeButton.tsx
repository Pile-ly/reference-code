// The heart. Design constraints straight from the platform:
//  - a like is one record per user per post in the `likes` table;
//  - users cannot delete records, so there is NO un-like — the filled heart
//    is inert (with an honest toast), never a fake toggle;
//  - dedupe is client-side by `_submitter_handle` BEFORE creating;
//  - signed-out clicks get the sign-in nudge (gated on `user`, not 401s).
// The like is optimistic: the count moves at once and rolls back if the
// server refuses it, in which case the refusal renders beside the heart.

import { Icon } from "@iconify/react";
import { usePilelyAuth } from "@pilely/core";
import { useCreateRecord } from "@pilely/simple-db";
import { useTranslation } from "react-i18next";
import { usePostLikes } from "../hooks/useBlogRecords";
import { type LikeRecord, likedBy } from "../lib/records";
import { useToastStore } from "../stores/toast_store";

export function LikeButton({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const { user } = usePilelyAuth();
  const { data: likes } = usePostLikes(postId);
  const createLike = useCreateRecord<LikeRecord>("likes");
  const show = useToastStore((s) => s.show);

  const count = likes?.length ?? 0;
  const liked = likedBy(likes, postId, user?.handle);

  const onClick = () => {
    if (!user) {
      show(t("post.signInToLike"));
      return;
    }
    if (liked) {
      show(t("post.alreadyLiked"));
      return;
    }
    createLike.mutate({ post_id: postId });
  };

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent text-[14px]"
        style={{ color: liked ? "var(--accent)" : "var(--muted)" }}
        aria-label={t("post.likeAria")}
        aria-pressed={liked}
        disabled={createLike.isPending}
        onClick={onClick}
      >
        <Icon icon={liked ? "ph:heart-fill" : "ph:heart"} width={20} />
        {count}
      </button>
      {createLike.error && (
        <span role="alert" className="text-[12.5px]" style={{ color: "var(--accent)" }}>
          {t("post.likeRefused", { reason: createLike.error.message })}
        </span>
      )}
    </span>
  );
}
