// What renders instead of any page while nobody is signed in: this app is
// PRIVATE, no anonymous credential exists (client.js mints none for
// non-public apps). In practice a signed-out visitor rarely gets this far —
// on a non-public app the platform gates even the SHELL behind its own
// bootstrap sign-in page — so this gate mostly covers the in-app sign-out
// moment (and any embed where the shell was reached another way). Gated on
// `user() === null` — NEVER on a status code (a signed-in non-owner gets
// uniform 404s from the data layer and a different panel entirely).

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/session_store";

export function SignInGate() {
  const { t } = useTranslation();
  const signIn = useSessionStore((s) => s.signIn);
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-24 text-center">
      <Icon icon="ph:leaf-fill" width={34} style={{ color: "var(--accent)" }} />
      <p className="max-w-[340px] text-[14px]" style={{ color: "var(--muted)" }}>
        {t("gate.lead")}
      </p>
      <button type="button" className="btn btn-accent" onClick={signIn}>
        {t("gate.signIn")}
      </button>
    </div>
  );
}
