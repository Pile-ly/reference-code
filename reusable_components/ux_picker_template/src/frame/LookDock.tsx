import { useTranslation } from "react-i18next";
import { LOOKS, type LookId } from "./looks";

type Props = {
  look: LookId;
  onChange: (look: LookId) => void;
};

export function LookDock({ look, onChange }: Props) {
  const { t } = useTranslation();
  const step = (delta: number) => {
    const at = LOOKS.findIndex((l) => l.id === look);
    onChange(LOOKS[(at + delta + LOOKS.length) % LOOKS.length].id);
  };

  return (
    <nav className="dock" aria-label={t("picker.looks.label")}>
      <button className="arrow" aria-label={t("picker.looks.previous")} onClick={() => step(-1)}>
        ‹
      </button>
      {LOOKS.map(({ id, name }) => (
        <button key={id} aria-pressed={id === look} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
      <button className="arrow" aria-label={t("picker.looks.next")} onClick={() => step(1)}>
        ›
      </button>
    </nav>
  );
}
