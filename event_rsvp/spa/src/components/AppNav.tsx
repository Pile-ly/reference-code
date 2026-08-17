// Top navigation. What the right side shows is decided by ONE question —
// who is `window.pilely.user()` (via the session store):
//   signed out            → "Login with Pilely"
//   signed in, not owner  → @handle + sign out
//   the host              → an extra accent "Host portal" link to /admin
// Never gated on a 401/404 (public apps hold an anon token, so denials are
// uniform 404s and statuses say nothing about sign-in). The host link is a
// UI convenience: the empty groups on the two tables are what actually
// decide who may publish an event or read an RSVP.

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { HOST } from "../config";
import { useTheme } from "../hooks/useTheme";
import { useSessionStore } from "../stores/session_store";

function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="mini-btn" aria-label={t("theme.toggleAria")} onClick={toggle}>
      <Icon icon={theme === "dark" ? "ph:sun" : "ph:moon"} width={15} />
    </button>
  );
}

export function AppNav() {
  const { t } = useTranslation();
  const { ready, user, isOwner, signIn, signOut } = useSessionStore();

  return (
    <div className="app-nav">
      <div className="mx-auto flex max-w-[600px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-3.5">
        <Link to="/" className="brand">
          <span className="brand-dot" aria-hidden="true">
            {HOST.mark}
          </span>
          {HOST.name}
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isOwner && (
            <Link to="/admin" className="host-link">
              {t("nav.hostPortal")}
            </Link>
          )}
          <ThemeToggle />
          {ready && !user && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={signIn}>
              {t("nav.signIn")}
            </button>
          )}
          {user && (
            <>
              <span className="text-[13px]" style={{ color: "var(--muted)" }}>
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
        </div>
      </div>
    </div>
  );
}
