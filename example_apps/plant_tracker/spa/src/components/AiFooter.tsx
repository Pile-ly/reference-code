// SPA standard §7b: every app visibly tells human visitors it also works
// from an AI client, quoting the app's own address. The address comes from
// `window.location.origin` at RUNTIME — the app label is mutable, so a
// hardcoded host here is exactly the bug the standard warns about — and the
// sentence goes through i18n with the origin interpolated.

import { useTranslation } from "react-i18next";

export function AiFooter() {
  const { t } = useTranslation();
  return (
    <footer
      className="border-t px-5 py-6 text-center text-[12.5px]"
      style={{ borderColor: "var(--hairline)", color: "var(--faint)" }}
    >
      {t("footer.aiHint", { origin: window.location.origin })}
    </footer>
  );
}
