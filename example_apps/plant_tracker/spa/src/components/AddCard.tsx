// The grid's last cell: a dashed "add plant" affordance (UX spec — dashed
// goes solid + accent on hover, like every empty affordance here).

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function AddCard() {
  const { t } = useTranslation();
  return (
    <Link
      to="/add"
      className="dashed-pick flex min-h-[178px] flex-col items-center justify-center gap-1 rounded-[14px]"
    >
      <span className="text-[26px] leading-none">{"+"}</span>
      <span className="text-[12.5px]">{t("home.addPlant")}</span>
    </Link>
  );
}
