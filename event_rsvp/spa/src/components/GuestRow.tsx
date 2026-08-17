// One line of the host's guest list: who answered, what they said, their
// note, and whether they changed their mind.
//
// The handle and the time are server-minted (`_submitter_handle` /
// `_created_at_ms`) — the app declares no author or sent-at column. The
// "changed" mark comes from the roll-up: the guest sent more than one row,
// because that is the only way to change an answer here.

import { useTranslation } from "react-i18next";
import type { RsvpRecord } from "../lib/db";

interface Props {
  rsvp: RsvpRecord;
  changed: boolean;
}

export function GuestRow({ rsvp, changed }: Props) {
  const { t } = useTranslation();
  return (
    <div className="guest">
      <b className="font-semibold">{"@" + rsvp._submitter_handle}</b>
      <span className={`chip ${rsvp.status}`}>
        {rsvp.status === "going"
          ? t("admin.guestGoing", { count: rsvp.party })
          : t("admin.guestCant")}
      </span>
      {rsvp.note && (
        <span className="min-w-0 flex-1 break-words" style={{ color: "var(--muted)" }}>
          {`"${rsvp.note}"`}
        </span>
      )}
      {changed && (
        <span className="ml-auto text-[11px]" style={{ color: "var(--faint)" }}>
          {t("admin.changed")}
        </span>
      )}
    </div>
  );
}
