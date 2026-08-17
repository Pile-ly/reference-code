// Top navigation. What the right side shows is decided by ONE question —
// who is `window.pilely.user()` (via the session store):
//   signed out → "Login with Pilely" (the content below is the gate anyway)
//   signed in  → "+ Plant" · sign out
// There is no owner-vs-visitor branch: on a private app a signed-in
// non-owner gets uniform 404s from the data layer, never a different nav.
// The brand line shows WHO the journal belongs to, straight from the
// signed-in claims — no configured owner handle (see config.ts).

import { Icon } from "@iconify/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { APP_TITLE } from "../config";
import { useTheme } from "../hooks/useTheme";
import { useSessionStore } from "../stores/session_store";

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

export function AppNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { ready, user, signIn, signOut } = useSessionStore();

  return (
    <div className="app-nav border-b" style={{ borderColor: "var(--hairline)" }}>
      <div className="mx-auto flex max-w-[860px] flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2 whitespace-nowrap text-[16px] font-bold">
          <Icon icon="ph:leaf-fill" width={18} style={{ color: "var(--accent)" }} />
          {APP_TITLE}
          {user && (
            <span className="text-[12px] font-normal" style={{ color: "var(--faint)" }}>
              {t("nav.ownerOnly", { handle: user.handle })}
            </span>
          )}
        </Link>
        <div className="flex items-center justify-end gap-2.5">
          <ThemeToggle />
          {ready && !user && (
            <button type="button" className="btn btn-ghost" onClick={signIn}>
              {t("nav.signIn")}
            </button>
          )}
          {user && (
            <>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => void navigate({ to: "/add" })}
              >
                {t("nav.addPlant")}
              </button>
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
