// Top navigation. What the right side shows is decided by ONE question —
// who is `usePilelyAuth().user`:
//   signed out            → "Login with Pilely"
//   signed in, not owner  → @handle + sign out
//   the owner             → Drafts (n) · New post · @handle + sign out
// Never gated on a 401/404 (public apps hold an anon token; denials are
// uniform 404s — statuses say nothing about sign-in).

import { Icon } from "@iconify/react";
import { usePilelyAuth } from "@pilely/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BLOG_TITLE } from "../config";
import { useDrafts } from "../hooks/useBlogRecords";
import { useIsOwner } from "../hooks/useIsOwner";
import { useTheme } from "../hooks/useTheme";

function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="mini-btn"
      aria-label={t("theme.toggleAria")}
      onClick={toggle}
    >
      <Icon icon={theme === "dark" ? "ph:sun" : "ph:moon"} width={15} />
    </button>
  );
}

/** Drafts (n) · New post. Mounted for the owner only, so the owner-only
 *  `drafts` table is read only by the one visitor allowed to read it. */
function OwnerActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: drafts } = useDrafts();
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => void navigate({ to: "/drafts" })}
      >
        {t("nav.drafts", { count: drafts?.length ?? 0 })}
      </button>
      <button
        type="button"
        className="btn btn-accent"
        onClick={() => void navigate({ to: "/write" })}
      >
        {t("nav.newPost")}
      </button>
    </>
  );
}

export function AppNav() {
  const { t } = useTranslation();
  const { ready, user, signIn, signOut } = usePilelyAuth();
  const isOwner = useIsOwner();

  return (
    <div className="app-nav border-b" style={{ borderColor: "var(--hairline)" }}>
      <div className="mx-auto flex max-w-[640px] flex-wrap items-center justify-between gap-3 px-5 py-3.5 sm:px-7">
        <Link
          to="/"
          className="whitespace-nowrap text-[17px] font-bold"
          style={{ fontFamily: "var(--serif)" }}
        >
          {BLOG_TITLE}
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <ThemeToggle />
          {ready && !user && (
            <button type="button" className="btn btn-ghost" onClick={() => void signIn()}>
              {t("nav.signIn")}
            </button>
          )}
          {isOwner && <OwnerActions />}
          {user && (
            <>
              <span className="text-[13px]" style={{ color: "var(--muted)" }}>
                {"@" + (user.handle ?? "")}
              </span>
              <button
                type="button"
                className="mini-btn"
                aria-label={t("nav.signOut")}
                onClick={signOut}
              >
                <Icon icon="ph:sign-out" width={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
