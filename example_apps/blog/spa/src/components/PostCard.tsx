// One tile in the home grid: a generated cover, then title, subtitle, and the
// date / read-time / like / comment tallies (the counts are derived by the
// caller from the loaded tables).

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { PostRecord } from "../lib/db";
import { formatDate, readMins } from "../lib/time";
import { CoverArt } from "./CoverArt";

interface Props {
  post: PostRecord;
  likeCount: number;
  commentCount: number;
}

export function PostCard({ post, likeCount, commentCount }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <Link to="/post/$postId" params={{ postId: post.id }} className="tile cursor-pointer">
      <div className="cover">
        <CoverArt seed={post.id} />
      </div>
      <h3 className="tile-title mt-3.5">{post.title}</h3>
      {post.subtitle && <p className="tile-sub mt-1.5">{post.subtitle}</p>}
      <div className="metarow mt-2.5">
        <span>{formatDate(post._created_at_ms, i18n.language)}</span>
        <span className="dot" />
        <span>{t("card.minRead", { mins: readMins(post.body_md) })}</span>
        <span className="mi">
          <Icon icon="ph:heart" width={13} />
          {likeCount}
        </span>
        {commentCount > 0 && (
          <span className="mi">
            <Icon icon="ph:chat-circle" width={13} />
            {commentCount}
          </span>
        )}
      </div>
    </Link>
  );
}
