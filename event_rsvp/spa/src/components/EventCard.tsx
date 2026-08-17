// One event in the home list: cover strip, date badge, title, when/where,
// and the chips. Past events render dimmed and greyed (the UX spec's
// treatment) and lose their RSVP affordance.
//
// The "you're going" chip is the per-device memo (lib/device_memo.ts), not
// server state — this app cannot read a guest's RSVP back, and the chip is
// only ever shown to the browser that sent it. There is deliberately NO
// attendance count anywhere on this card: RSVP status is the host's to
// see, nobody else's.

import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { EventRecord } from "../lib/db";
import type { RsvpMemo } from "../lib/device_memo";
import { formatShortWhen, isPast } from "../lib/time";
import { tintOf } from "../stores/event_store";
import { CoverImage } from "./CoverImage";
import { DateBadge } from "./DateBadge";

interface Props {
  event: EventRecord;
  /** This device's memo for this event, if it sent one. */
  memo: RsvpMemo | null;
}

export function EventCard({ event, memo }: Props) {
  const { t } = useTranslation();
  const past = isPast(event.starts_at_ms);

  return (
    <Link
      to="/event/$eventId"
      params={{ eventId: event.id }}
      className={`ecard ${past ? "past" : ""}`}
      aria-label={t("home.openEventAria", { title: event.title })}
    >
      <CoverImage
        blobId={event.cover_blob_id}
        tintIndex={tintOf(event.id)}
        className="h-[120px] w-full"
        alt=""
      />
      <div className="flex gap-3.5 px-4 pt-3 pb-3.5">
        <DateBadge startsAtMs={event.starts_at_ms} tz={event.tz} />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold break-words">{event.title}</div>
          <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
            {formatShortWhen(event.starts_at_ms, event.tz)}
            {event.place ? ` · ${event.place}` : ""}
          </div>
          {(event.canceled || memo) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {event.canceled && <span className="chip canceled">{t("event.canceled")}</span>}
              {memo && (
                <span className={`chip ${memo.status}`}>
                  {memo.status === "going"
                    ? t("home.memoGoing", { count: memo.party })
                    : t("home.memoCant")}
                </span>
              )}
            </div>
          )}
        </div>
        {!past && !event.canceled && (
          <span className="btn btn-ghost btn-sm self-center">{t("home.rsvp")}</span>
        )}
      </div>
    </Link>
  );
}
