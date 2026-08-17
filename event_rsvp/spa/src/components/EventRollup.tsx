// One event's card in the host portal: its details, the three counts, the
// guest list, and the Edit / Cancel / Delete controls.
//
// The counts and the list come from lib/rollup.ts — the latest row per
// `_submitter_handle`, because `rsvps` is an append-only log of answers
// (guests cannot update their own rows, so a changed mind is a new row).
//
// Cancel and Delete are deliberately DIFFERENT actions, unlike the demo's
// single button that changed label:
//   Cancel  flips the `canceled` boolean. History kept, guests see the
//           event as canceled, the RSVPs stay.
//   Delete  is the cascade — RSVP rows, then the event, then the cover
//           blob — and is offered only once an event is canceled, behind a
//           confirm that names exactly what is purged. Blobs and records
//           are hard-deleted; there is no undo anywhere in this path.

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { EventRecord, RsvpRecord } from "../lib/db";
import type { EventRollup as Rollup } from "../lib/rollup";
import { formatWhen } from "../lib/time";
import { GuestRow } from "./GuestRow";

interface Props {
  event: EventRecord;
  rollup: Rollup;
  /** Null while the RSVP list is still loading. */
  rows: RsvpRecord[] | null;
  busy: boolean;
  onEdit: () => void;
  onToggleCancel: () => void;
  onDelete: () => void;
}

export function EventRollup({
  event,
  rollup,
  rows,
  busy,
  onEdit,
  onToggleCancel,
  onDelete,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="card mb-3.5">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
            <span className="break-words">{event.title}</span>
            {event.canceled && <span className="chip canceled">{t("event.canceled")}</span>}
          </div>
          <div className="mt-0.5 text-[12px]" style={{ color: "var(--muted)" }}>
            {formatWhen(event.starts_at_ms, event.tz)}
            {event.place ? ` · ${event.place}` : ""}
          </div>
        </div>
        <div className="flex flex-none flex-wrap justify-end gap-1.5">
          <button type="button" className="mini-btn" disabled={busy} onClick={onEdit}>
            {t("admin.edit")}
          </button>
          <button type="button" className="mini-btn" disabled={busy} onClick={onToggleCancel}>
            {event.canceled ? t("admin.uncancelEvent") : t("admin.cancelEvent")}
          </button>
          {event.canceled && (
            <button type="button" className="mini-btn danger" disabled={busy} onClick={onDelete}>
              <Icon icon="ph:trash" width={13} />
              {t("admin.deleteEvent")}
            </button>
          )}
        </div>
      </div>

      <div className="my-3 flex gap-2">
        <div className="astat">
          <div className="astat-v">{rollup.going.length}</div>
          <div className="astat-k">{t("admin.going")}</div>
        </div>
        <div className="astat">
          <div className="astat-v">{rollup.headcount}</div>
          <div className="astat-k">{t("admin.headcount")}</div>
        </div>
        <div className="astat">
          <div className="astat-v">{rollup.cant.length}</div>
          <div className="astat-k">{t("admin.cant")}</div>
        </div>
      </div>

      {rows === null ? (
        <p className="py-1.5 text-[12.5px]" style={{ color: "var(--faint)" }}>
          {t("admin.loadingRsvps")}
        </p>
      ) : rollup.latest.length === 0 ? (
        <p className="py-1.5 text-[12.5px]" style={{ color: "var(--faint)" }}>
          {t("admin.noRsvps")}
        </p>
      ) : (
        rollup.latest.map((r) => (
          <GuestRow key={r.id} rsvp={r} changed={rollup.changed.has(r._submitter_handle)} />
        ))
      )}
    </div>
  );
}
