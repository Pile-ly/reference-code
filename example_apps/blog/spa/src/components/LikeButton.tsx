// The heart. Design constraints straight from the platform:
//  - a like is one record per user per post in the `likes` table;
//  - users cannot delete records, so there is NO un-like — the filled heart
//    is inert (with an honest toast), never a fake toggle;
//  - dedupe is client-side by `_submitter_handle` BEFORE creating;
//  - signed-out clicks get the sign-in nudge (gated on `user()`, not 401s).

import { Icon } from "@iconify/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { likedBy, likesFor, useBlogStore } from "../stores/blog_store";
import { useSessionStore } from "../stores/session_store";
import { useToastStore } from "../stores/toast_store";

export function LikeButton({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const likes = useBlogStore((s) => s.likes);
  const likePost = useBlogStore((s) => s.likePost);
  const user = useSessionStore((s) => s.user);
  const show = useToastStore((s) => s.show);
  const [pending, setPending] = useState(false);

  const count = likesFor(likes, postId).length;
  const liked = likedBy(likes, postId, user?.handle ?? null);

  const onClick = async () => {
    if (!user) {
      show(t("post.signInToLike"));
      return;
    }
    if (liked) {
      show(t("post.alreadyLiked"));
      return;
    }
    setPending(true);
    try {
      await likePost(postId);
    } catch (e) {
      show(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className="flex cursor-pointer items-center gap-1.5 border-none bg-transparent text-[14px]"
      style={{ color: liked ? "var(--accent)" : "var(--muted)" }}
      aria-label={t("post.likeAria")}
      aria-pressed={liked}
      disabled={pending}
      onClick={() => void onClick()}
    >
      <Icon icon={liked ? "ph:heart-fill" : "ph:heart"} width={20} />
      {count}
    </button>
  );
}
