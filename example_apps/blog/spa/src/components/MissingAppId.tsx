// Rendered instead of the app while index.html still carries the
// placeholder pile id: a bundle with the placeholder has broken sign-in and
// every data call fails, so it says so plainly instead of rendering a blog
// that can never load.

import { useTranslation } from "react-i18next";

export function MissingAppId() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-[640px] px-5 py-16 sm:px-7">
      <h1 className="text-[24px] font-bold" style={{ fontFamily: "var(--serif)" }}>
        {t("setup.noAppIdTitle")}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {t("setup.noAppIdBody")}
      </p>
    </div>
  );
}
