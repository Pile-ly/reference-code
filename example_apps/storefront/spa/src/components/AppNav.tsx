// Top navigation. What the right side shows is decided by ONE question —
// who is `window.pilely.user()` (via the session store):
//   signed out            → "Login with Pilely"
//   signed in, not owner  → @handle + sign out
//   the owner             → an extra accent "Inquiries" link to /admin
// Never gated on a 401/404 (public apps hold an anon token; denials are
// uniform 404s — statuses say nothing about sign-in). The owner link is a
// UI convenience: simple_db's empty read group is what actually protects
// the inbox.

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BUSINESS } from "../config";
import { useTheme } from "../hooks/useTheme";
import { useSessionStore } from "../stores/session_store";

function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={t("theme.toggleAria")}
      onClick={toggle}
    >
      <Icon icon={theme === "dark" ? "ph:sun" : "ph:moon"} width={15} />
    </button>
  );
}

export function AppNav() {
  const { t } = useTranslation();
  const { ready, user, isOwner, signIn, signOut } = useSessionStore();

  return (
    <div className="app-nav">
      <div className="mx-auto flex max-w-[1060px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 sm:px-7">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Icon icon="ph:boxing-glove" width={17} />
          </span>
          <span className="words">
            {BUSINESS.wordmark.lead} <em>{BUSINESS.wordmark.accent}</em> {BUSINESS.wordmark.tail}
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-2">
          <Link to="/classes" className="nav-link" activeProps={{ className: "nav-link on" }}>
            {t("nav.classes")}
          </Link>
          <Link to="/contact" className="nav-link" activeProps={{ className: "nav-link on" }}>
            {t("nav.contact")}
          </Link>
          {isOwner && (
            <Link
              to="/admin"
              className="nav-link nav-link-admin"
              activeProps={{ className: "nav-link nav-link-admin on" }}
            >
              {t("nav.inquiries")}
            </Link>
          )}
          <span className="ml-1.5 flex items-center gap-2">
            <ThemeToggle />
            {ready && !user && (
              <button type="button" className="cta" onClick={signIn}>
                {t("nav.signIn")}
              </button>
            )}
            {user && (
              <>
                <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  {"@" + user.handle}
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
          </span>
        </div>
      </div>
    </div>
  );
}
