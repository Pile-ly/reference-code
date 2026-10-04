// Home: masthead + a featured lead story + the covered post grid. This page
// renders for signed-out visitors with ZERO auth code — the
// `posts`/`comments`/`likes` tables are `anon_read`, and the platform client
// quietly holds an anonymous credential on a public app. Signing in changes
// nothing here but the nav.
//
// Three reads, one per public table; counts are derived from the loaded
// comments and likes. "More posts" loads the next page of every table that
// has one, so older posts arrive with their counts.

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Avatar } from "../components/Avatar";
import { CoverArt } from "../components/CoverArt";
import { PostCard } from "../components/PostCard";
import { BLOG_TAGLINE, BLOG_TITLE, OWNER_HANDLE } from "../config";
import { useComments, useLikes, usePosts } from "../hooks/useBlogRecords";
import { commentsFor, likesFor } from "../lib/records";
import { formatDate, readMins } from "../lib/time";

export function HomePage() {
  const { t, i18n } = useTranslation();
  const postsQuery = usePosts();
  const commentsQuery = useComments();
  const likesQuery = useLikes();
  const tables = [postsQuery, commentsQuery, likesQuery];

  const posts = postsQuery.data;
  const comments = commentsQuery.data;
  const likes = likesQuery.data;
  const loading = postsQuery.isPending;
  const homeError = tables.find((q) => q.error)?.error?.message ?? null;
  const hasMore = tables.some((q) => q.hasNextPage);
  const fetchingMore = tables.some((q) => q.isFetchingNextPage);

  const onMore = () => {
    for (const q of tables) {
      if (q.hasNextPage) void q.fetchNextPage();
    }
  };

  const featured = posts?.[0] ?? null;
  const rest = posts?.slice(1) ?? [];

  return (
    <div className="mx-auto max-w-[640px] px-5 sm:px-7">
      <div className="pb-8 pt-11 text-center">
        <h1
          className="text-[30px] font-bold tracking-tight sm:text-[40px]"
          style={{ fontFamily: "var(--serif)" }}
        >
          {BLOG_TITLE}
        </h1>
        <div className="mx-auto mt-4 h-[3px] w-11 rounded-full" style={{ background: "var(--accent)" }} />
        <p className="mt-4 text-[15.5px]" style={{ color: "var(--muted)" }}>
          {BLOG_TAGLINE + " — "}
          <b className="font-semibold" style={{ color: "var(--ink)" }}>
            {t("masthead.by", { handle: OWNER_HANDLE })}
          </b>
        </p>
      </div>

      {loading && !homeError && (
        <p className="py-6 text-center text-[14px]" style={{ color: "var(--faint)" }}>
          {t("common.loading")}
        </p>
      )}
      {homeError && (
        <p className="py-6 text-center text-[14px]" style={{ color: "var(--accent)" }}>
          {t("common.error", { reason: homeError })}
        </p>
      )}
      {posts !== undefined && posts.length === 0 && !homeError && (
        <p className="py-10 text-center text-[14px]" style={{ color: "var(--faint)" }}>
          {t("home.empty")}
        </p>
      )}

      {featured && (
        <Link to="/post/$postId" params={{ postId: featured.id }} className="lead block">
          <div className="cover">
            <CoverArt seed={featured.id} />
          </div>
          <div className="eyebrow mt-4">{t("card.latest")}</div>
          <h2 className="lead-title mt-2">{featured.title}</h2>
          {featured.subtitle && <p className="lead-sub mt-2.5">{featured.subtitle}</p>}
          <div className="metarow mt-3.5">
            <Avatar handle={featured._submitter_handle} size={26} />
            <span className="font-semibold" style={{ color: "var(--muted)" }}>
              {"@" + featured._submitter_handle}
            </span>
            <span className="dot" />
            <span>{formatDate(featured._created_at_ms, i18n.language)}</span>
            <span className="dot" />
            <span>{t("card.minRead", { mins: readMins(featured.body_md) })}</span>
            <span className="mi">
              <Icon icon="ph:heart" width={13} />
              {likesFor(likes, featured.id).length}
            </span>
            <span>{t("card.comments", { count: commentsFor(comments, featured.id).length })}</span>
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <div className="feed-grid mt-10">
          {rest.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              likeCount={likesFor(likes, post.id).length}
              commentCount={commentsFor(comments, post.id).length}
            />
          ))}
        </div>
      )}
      {hasMore && (
        <div className="mt-8 text-center">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={fetchingMore}
            onClick={onMore}
          >
            {t("home.more")}
          </button>
        </div>
      )}
      <div className="h-12" />
    </div>
  );
}
