// Rendered instead of the app while index.html still carries the
// placeholder pile id: a bundle with the placeholder has broken sign-in and
// every data call fails, so it says so plainly instead of rendering a
// storefront whose inquiry form can never send.

import { useTranslation } from "react-i18next";

export function MissingAppId() {
  const { t } = useTranslation();
  return (
    <div className="page narrow">
      <h1 className="page-title">{t("setup.noAppIdTitle")}</h1>
      <p className="page-lead">{t("setup.noAppIdBody")}</p>
    </div>
  );
}
