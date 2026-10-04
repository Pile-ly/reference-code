// The class list — pure config content (src/config.ts), shown as cards with
// a generated cover each. Each card's "Inquire" routes to /contact with the
// class pre-filled; it lands in the inquiry's optional `class` column and
// shows as a chip on the admin list.

import { useTranslation } from "react-i18next";
import { ClassCard } from "../components/ClassCard";
import { BUSINESS, CLASSES } from "../config";

export function ClassesPage() {
  const { t } = useTranslation();
  return (
    <div className="page view-anim">
      <h2 className="page-title">{t("classes.heading")}</h2>
      <p className="page-lead">{BUSINESS.classesLead}</p>
      <div className="class-grid">
        {CLASSES.map((c) => (<ClassCard key={c.id} c={c} />))}
      </div>
    </div>
  );
}
