// The plant page's three stat tiles: last watered / count / avg gap.
// All three are derived client-side from the loaded waterings (timestamps
// are the server's _created_at_ms; the math is lib/stats.ts).

import { useTranslation } from "react-i18next";
import { agoLabel } from "../lib/time";

interface Props {
  lastWateredMs: number | null;
  count: number;
  avgDays: number | null;
}

export function StatTiles({ lastWateredMs, count, avgDays }: Props) {
  const { t } = useTranslation();
  const tiles: Array<{ value: string; label: string }> = [
    {
      value:
        lastWateredMs === null
          ? t("stats.none")
          : agoLabel((k, o) => String(t(k, o)), lastWateredMs),
      label: t("stats.lastWatered"),
    },
    { value: String(count), label: t("stats.waterings") },
    {
      value: avgDays === null ? t("stats.none") : t("stats.gapDays", { count: avgDays }),
      label: t("stats.avgGap"),
    },
  ];
  return (
    <div className="my-4 flex gap-2.5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex-1 rounded-[10px] px-3 py-2.5"
          style={{ background: "var(--canvas)" }}
        >
          <div className="text-[16px] font-bold">{tile.value}</div>
          <div
            className="mt-[2px] text-[10.5px] uppercase tracking-[0.04em]"
            style={{ color: "var(--faint)" }}
          >
            {tile.label}
          </div>
        </div>
      ))}
    </div>
  );
}
