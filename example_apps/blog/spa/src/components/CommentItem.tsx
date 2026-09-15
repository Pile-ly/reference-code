// One comment. Byline is free — the server mints `_submitter_handle` on
// every record. Commenters cannot edit or delete their own comments (the
// platform reserves update/delete for the owner); the ONLY moderation is
// the owner's Remove, so that button renders for the owner alone.

import { useTranslation } from "react-i18next";
import type { CommentRecord } from "../lib/db";
import { timeAgo } from "../lib/time";
import { useBlogStore } from "../stores/blog_store";
import { useSessionStore } from "../stores/session_store";
import { useToastStore } from "../stores/toast_store";
import { Avatar } from "./Avatar";

export function CommentItem({ comment }: { comment: CommentRecord }) {
  const { t, i18n } = useTranslation();
  const isOwner = useSessionStore((s) => s.isOwner);
  const removeComment = useBlogStore((s) => s.removeComment);
  const show = useToastStore((s) => s.show);

  const onRemove = async () => {
    if (!window.confirm(t("post.confirmRemove"))) return;
    try {
      await removeComment(comment.id);
      show(t("post.commentRemoved"));
    } catch (e) {
      show(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="mb-5 flex gap-3">
      <Avatar handle={comment._submitter_handle} size={30} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">
          <b className="font-semibold">{"@" + comment._submitter_handle}</b>{" "}
          <span style={{ color: "var(--faint)" }}>
            {"· " + timeAgo(comment._created_at_ms, Date.now(), i18n.language)}
          </span>
        </div>
        <div className="mt-0.5 break-words text-[14.5px] leading-[1.55]">{comment.body}</div>
      </div>
      {isOwner && (
        <button
          type="button"
          className="mini-btn mini-btn-danger ml-auto self-start"
          onClick={() => void onRemove()}
        >
          {t("post.remove")}
        </button>
      )}
    </div>
  );
}
