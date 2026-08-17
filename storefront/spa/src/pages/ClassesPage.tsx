// The class list — pure config content (src/config.ts). Each row's
// "Inquire" routes to /contact with the class pre-filled; it lands in the
// inquiry's optional `class` column and shows as a chip on the admin list.

import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BUSINESS, CLASSES } from "../config";

export function ClassesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="page">
      <h2 className="page-title">{t("classes.heading")}</h2>
      <p className="page-lead">{BUSINESS.classesLead}</p>
      {CLASSES.map((c) => (
        <div key={c.id} className="flex items-center gap-4 border-t py-4.5" style={{ borderColor: "var(--hairline)" }}>
          <div>
            <div className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
              {c.name}
              <span className={`lvl lvl-${c.levelTone}`}>{c.level}</span>
            </div>
            <div className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
              {c.schedule} · {c.coach}
            </div>
          </div>
          <button
            type="button"
            className="inquire-btn ml-auto"
            onClick={() => void navigate({ to: "/contact", search: { class: c.id } })}
          >
            {t("classes.inquire")}
          </button>
        </div>
      ))}
    </div>
  );
}
