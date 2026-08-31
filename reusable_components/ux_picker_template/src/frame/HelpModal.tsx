import { Trans, useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/* The explainer is deliberately app-agnostic: it describes what the page is
   for in plain words, and says the same thing for every app. */
export function HelpModal({ open, onOpen, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <button className="help-btn" aria-label={t("picker.help.open")} onClick={onOpen}>
        ?
      </button>

      {open && (
        <div className="help-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="help-card" role="dialog" aria-modal="true" aria-label={t("picker.help.title")}>
            <button className="x" aria-label={t("picker.help.close")} onClick={onClose}>
              ✕
            </button>
            <h3>{t("picker.help.title")}</h3>
            <p>
              <Trans i18nKey="picker.help.p1" components={[<span />, <strong />]} />
            </p>
            <p>
              <Trans i18nKey="picker.help.p2" components={[<strong />]} />
            </p>
            <p>
              <Trans i18nKey="picker.help.p3" components={[<span />, <em />]} />
            </p>
            <p>
              <Trans
                i18nKey="picker.help.p4"
                components={[<span />, <strong />, <span />, <em />, <span />, <strong />]}
              />
            </p>
            <button className="got-it" onClick={onClose}>
              {t("picker.help.gotIt")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
