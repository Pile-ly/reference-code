import { useTranslation } from "react-i18next";

type Props = {
  wide: boolean;
  onChange: (wide: boolean) => void;
};

/* The note above the toggle is the one thing on this page that manages the
   user's expectations: these are style samples, not the app's page list.
   Without it people read the three screens as a spec and start asking why
   a page they need is missing. */
export function WidthToggle({ wide, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <p className="picker-note">{t("picker.note")}</p>

      <div className="wt" role="group" aria-label={t("picker.width.label")}>
        <button aria-pressed={!wide} onClick={() => onChange(false)}>
          {t("picker.width.phone")}
        </button>
        <button aria-pressed={wide} onClick={() => onChange(true)}>
          {t("picker.width.computer")}
        </button>
      </div>
    </>
  );
}
