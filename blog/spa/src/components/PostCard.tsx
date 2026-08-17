// One feed entry on the home page: title, subtitle, date, read-mins, and
// the like/comment tallies (derived by the caller from the loaded tables).

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { PostRecord } from "../lib/db";
import { formatDate, readMins } from "../lib/time";

interface Props {
  post: PostRecord;
  likeCount: number;
  commentCount: number;
}

export function PostCard({ post, likeCount, commentCount }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <Link
      to="/post/$postId"
      params={{ postId: post.id }}
      className="group block cursor-pointer border-t py-6"
      style={{ borderColor: "var(--hairline)" }}
    >
      <div
        className="text-[21px] font-bold leading-[1.3] group-hover:underline group-hover:decoration-[var(--hairline)] group-hover:underline-offset-4"
        style={{ fontFamily: "var(--serif)" }}
      >
        {post.title}
      </div>
      {post.subtitle && (
        <div className="mt-1.5 text-[15px] leading-normal" style={{ color: "var(--muted)" }}>
          {post.subtitle}
        </div>
      )}
      <div
        className="mt-2.5 flex items-center gap-3.5 text-[12.5px]"
        style={{ color: "var(--faint)" }}
      >
        <span>{formatDate(post._created_at_ms, i18n.language)}</span>
        <span>{t("card.minRead", { mins: readMins(post.body_md) })}</span>
        <span className="flex items-center gap-1">
          <Icon icon="ph:heart" width={13} />
          {likeCount}
        </span>
        <span>{t("card.comments", { count: commentCount })}</span>
      </div>
    </Link>
  );
}
