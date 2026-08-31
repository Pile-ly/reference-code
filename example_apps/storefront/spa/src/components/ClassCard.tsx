// One class as a card: a generated energetic cover, the level chip, name,
// schedule/coach, and an Inquire button that routes to /contact with the
// class pre-filled (it lands in the inquiry's optional `class` column).

import { Icon } from "@iconify/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { GymClass } from "../config";
import { ClassArt } from "./ClassArt";

export function ClassCard({ c }: { c: GymClass }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <article className="class-card">
      <div className="cover">
        <ClassArt seed={c.id} />
        <span className={`lvl lvl-${c.levelTone}`}>{c.level}</span>
      </div>
      <div className="cc-body">
        <h3>{c.name}</h3>
        <div className="cc-meta">{c.schedule} · {c.coach}</div>
        <button
          type="button"
          className="inquire-btn"
          onClick={() => void navigate({ to: "/contact", search: { class: c.id } })}
        >
          {t("classes.inquire")} <Icon icon="ph:arrow-right" width={14} />
        </button>
      </div>
    </article>
  );
}
