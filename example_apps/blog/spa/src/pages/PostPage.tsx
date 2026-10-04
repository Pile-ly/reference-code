// One post: markdown body, like bar, comments. Readable signed-out
// (anon_read tables); the composer/like nudge gates on `user`; the
// Edit/Delete row gates on the owner handle — and simple_db enforces the
// real permission (update/delete is the owner's alone) no matter what the
// UI shows.

import { Icon } from "@iconify/react";
import { PilelyError } from "@pilely/core";
import { useDeleteRecord, useRecord } from "@pilely/simple-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar } from "../components/Avatar";
import { CommentComposer } from "../components/CommentComposer";
import { CommentItem } from "../components/CommentItem";
import { CoverArt } from "../components/CoverArt";
import { LikeButton } from "../components/LikeButton";
import { Markdown } from "../components/Markdown";
import { usePostComments } from "../hooks/useBlogRecords";
import { useIsOwner } from "../hooks/useIsOwner";
import { commentsFor, type PostRecord } from "../lib/records";
import { formatDate } from "../lib/time";
import { useToastStore } from "../stores/toast_store";

export function PostPage({ postId }: { postId: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isOwner = useIsOwner();
  const postQuery = useRecord<PostRecord>("posts", postId);
  const commentsQuery = usePostComments(postId);
  const deletePost = useDeleteRecord("posts");
  const show = useToastStore((s) => s.show);

  const post = postQuery.data;

  if (postQuery.isPending) {
    return (
      <p className="py-16 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("common.loading")}
      </p>
    );
  }

  // A 404 is missing OR denied — indistinguishable by design — so "not
  // found" is the only honest thing a public post page can render. An
  // optimistic delete also clears the record (data undefined).
  if (!post) {
    const missing =
      !postQuery.error ||
      (postQuery.error instanceof PilelyError && postQuery.error.status === 404);
    return (
      <div className="py-16 text-center">
        <p className="text-[15px]" style={{ color: "var(--muted)" }}>
          {missing
            ? t("common.notFound")
            : t("common.error", { reason: postQuery.error?.message ?? "" })}
        </p>
        <Link to="/" className="mt-4 inline-block text-[14px] underline underline-offset-4">
          {t("common.back")}
        </Link>
      </div>
    );
  }

  const postComments = commentsFor(commentsQuery.data, post.id);

  const onDelete = async () => {
    if (!window.confirm(t("post.confirmDelete"))) return;
    try {
      await deletePost.mutateAsync(post.id);
      show(t("post.postDeleted"));
      void navigate({ to: "/" });
    } catch (e) {
      show(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="mx-auto max-w-[640px] px-5 pb-15 pt-8 sm:px-7">
      <Link
        to="/"
        className="mb-5 inline-flex items-center gap-1.5 text-[13.5px]"
        style={{ color: "var(--muted)" }}
      >
        <Icon icon="ph:arrow-left" width={15} />
        {t("common.back")}
      </Link>
      <div className="cover post-hero">
        <CoverArt seed={post.id} />
      </div>
      <h1
        className="text-[25px] font-bold leading-tight tracking-tight sm:text-[32px]"
        style={{ fontFamily: "var(--serif)" }}
      >
        {post.title}
      </h1>
      {post.subtitle && (
        <p className="mt-2.5 text-[17px] leading-normal" style={{ color: "var(--muted)" }}>
          {post.subtitle}
        </p>
      )}

      <div
        className="mb-2 mt-5 flex items-center gap-2.5 border-b pb-4"
        style={{ borderColor: "var(--hairline)" }}
      >
        <Avatar handle={post._submitter_handle} />
        <div>
          <div className="text-[13.5px] font-semibold">{"@" + post._submitter_handle}</div>
          <div className="text-[12.5px]" style={{ color: "var(--faint)" }}>
            {formatDate(post._created_at_ms, i18n.language)}
          </div>
        </div>
        {isOwner && (
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="mini-btn"
              onClick={() => void navigate({ to: "/write", search: { post: post.id } })}
            >
              {t("post.edit")}
            </button>
            <button
              type="button"
              className="mini-btn mini-btn-danger"
              onClick={() => void onDelete()}
            >
              {t("post.delete")}
            </button>
          </div>
        )}
      </div>

      <Markdown>{post.body_md}</Markdown>

      <div
        className="mt-7 flex items-center gap-4 border-b border-t py-4"
        style={{ borderColor: "var(--hairline)" }}
      >
        <LikeButton postId={post.id} />
        <span className="text-[14px]" style={{ color: "var(--muted)" }}>
          {t("card.comments", { count: postComments.length })}
        </span>
      </div>

      <div className="py-6">
        <h3 className="mb-5 text-[15px] font-semibold">
          {t("post.commentsHeading", { count: postComments.length })}
        </h3>
        {postComments.map((c) => (
          <CommentItem key={c.id} comment={c} />
        ))}
        {commentsQuery.hasNextPage && (
          <button
            type="button"
            className="mini-btn mb-5"
            disabled={commentsQuery.isFetchingNextPage}
            onClick={() => void commentsQuery.fetchNextPage()}
          >
            {t("post.moreComments")}
          </button>
        )}
        <CommentComposer postId={post.id} />
      </div>
    </div>
  );
}
