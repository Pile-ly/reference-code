// Home: masthead + the published-post feed. This page renders for
// signed-out visitors with ZERO auth code — the `posts`/`comments`/`likes`
// tables are `anon_read`, and the platform client quietly holds an
// anonymous credential on a public app. Signing in changes nothing here
// but the nav.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PostCard } from "../components/PostCard";
import { BLOG_TAGLINE, BLOG_TITLE, OWNER_HANDLE } from "../config";
import { commentsFor, likesFor, useBlogStore } from "../stores/blog_store";

export function HomePage() {
  const { t } = useTranslation();
  const { posts, comments, likes, loadingHome, homeError, loadHome } = useBlogStore();

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  return (
    <div className="mx-auto max-w-[640px] px-5 sm:px-7">
      <div className="pb-9 pt-13 text-center">
        <h1
          className="text-[30px] font-bold tracking-tight sm:text-[40px]"
          style={{ fontFamily: "var(--serif)" }}
        >
          {BLOG_TITLE}
        </h1>
        <p className="mt-2.5 text-[15.5px]" style={{ color: "var(--muted)" }}>
          {BLOG_TAGLINE + " — "}
          <b className="font-semibold" style={{ color: "var(--ink)" }}>
            {t("masthead.by", { handle: OWNER_HANDLE })}
          </b>
        </p>
      </div>

      {loadingHome && posts === null && (
        <p className="py-6 text-center text-[14px]" style={{ color: "var(--faint)" }}>
          {t("common.loading")}
        </p>
      )}
      {homeError && (
        <p className="py-6 text-center text-[14px]" style={{ color: "var(--accent)" }}>
          {t("common.error", { reason: homeError })}
        </p>
      )}

      {(posts ?? []).map((post) => (
        <PostCard
          key={post.id}
          post={post}
          likeCount={likesFor(likes, post.id).length}
          commentCount={commentsFor(comments, post.id).length}
        />
      ))}
      <div className="h-10" />
    </div>
  );
}
