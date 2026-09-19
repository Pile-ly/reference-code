// One event in the home list, Luma-style: a generative/photo cover thumb, the
// date in accent, the title, and where. Past events render dimmed and greyed
// and lose their RSVP affordance.
//
// The "you're going" chip is the per-device memo (lib/device_memo.ts), not
// server state — this app cannot read a guest's RSVP back, and the chip is
// only ever shown to the browser that sent it. There is deliberately NO
// attendance count anywhere on this card: RSVP status is the host's to see,
// nobody else's.

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { EventRecord } from "../lib/db";
import type { RsvpMemo } from "../lib/device_memo";
import { formatShortWhen, isPast } from "../lib/time";
import { CoverImage } from "./CoverImage";

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
      <div className="ecover">
        <CoverImage blobId={event.cover_blob_id} seed={event.id} alt="" />
      </div>
      <div className="min-w-0">
        <span className="ewhen">
          <Icon icon="ph:calendar-blank" width={13} />
          {formatShortWhen(event.starts_at_ms, event.tz)}
        </span>
        <h3>{event.title}</h3>
        {event.place && <div className="eplace">{event.place}</div>}
        {(event.canceled || memo) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
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
      <span className="echev" aria-hidden="true">
        <Icon icon="ph:caret-right" width={18} />
      </span>
    </Link>
  );
}
