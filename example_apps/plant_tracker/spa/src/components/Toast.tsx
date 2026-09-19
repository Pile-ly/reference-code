// The single transient toast (bottom-center pill, per the UX spec) — plus
// the UNDO affordance when the toast store holds an undoable action (a
// just-logged watering; the callback is a REAL records/delete). Bottom
// offset respects the device safe area (§9).

import { useTranslation } from "react-i18next";
import { useToastStore } from "../stores/toast_store";

export function Toast() {
  const { t } = useTranslation();
  const message = useToastStore((s) => s.message);
  const undo = useToastStore((s) => s.undo);
  const runUndo = useToastStore((s) => s.runUndo);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 z-50 flex max-w-[92%] -translate-x-1/2 items-center gap-3 rounded-full px-[16px] py-[10px] text-[13px]"
      style={{
        background: "var(--ink)",
        color: "var(--on-ink)",
        bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <span>{message}</span>
      {undo && (
        <button
          type="button"
          className="cursor-pointer border-none bg-transparent text-[13px] font-semibold"
          style={{ color: "var(--toast-undo)" }}
          onClick={runUndo}
        >
          {t("toast.undo")}
        </button>
      )}
    </div>
  );
}
