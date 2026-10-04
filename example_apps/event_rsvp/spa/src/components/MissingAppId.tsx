// Rendered instead of the app while index.html still carries the
// placeholder pile id: a bundle with the placeholder has broken sign-in and
// every data call fails, so it says so plainly instead of rendering a club
// page that can never load.

import { useTranslation } from "react-i18next";

export function MissingAppId() {
  const { t } = useTranslation();
  return (
    <div className="col">
      <h1 className="pt-16 text-[21px] font-bold">{t("setup.noAppIdTitle")}</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {t("setup.noAppIdBody")}
      </p>
    </div>
  );
}
