// The club's introduction at the top of the home page. Everything here is
// config (src/config.ts) — the host is a constant of the deployment, not a
// record — so it renders identically for a signed-out stranger and for the
// host themselves.

import { useTranslation } from "react-i18next";
import { HOST, OWNER_HANDLE } from "../config";

export function HostHeader() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3.5 pt-6 pb-2">
      <div className="host-av" aria-hidden="true">
        {HOST.mark}
      </div>
      <div className="min-w-0">
        <h1 className="text-[21px] font-bold">{HOST.name}</h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>
          {HOST.tagline}
          {" · "}
          {t("home.hostedBy", { handle: OWNER_HANDLE })}
        </p>
      </div>
    </div>
  );
}
