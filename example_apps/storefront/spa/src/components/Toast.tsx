// The single transient toast (bottom-center pill, per the UX spec).

import { useToastStore } from "../stores/toast_store";

export function Toast() {
  const message = useToastStore((s) => s.message);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 max-w-[90%] -translate-x-1/2 rounded-full px-[18px] py-[10px] text-center text-[13px]"
      style={{ background: "var(--ink)", color: "var(--on-ink)" }}
    >
      {message}
    </div>
  );
}
