// One line of the host's guest list: who answered, what they said, their
// note, and whether they changed their mind.
//
// The handle and the time are server-minted (`_submitter_handle` /
// `_created_at_ms`) — the app declares no author or sent-at column. The
// "changed" mark comes from the roll-up: the guest sent more than one row,
// because that is the only way to change an answer here.

import { useTranslation } from "react-i18next";
import type { RsvpRecord } from "../lib/db";

// Deterministic avatar tint per handle, so the same guest is always the same
// color across the portal — no avatar storage anywhere.
const AV_PALETTE = ["#e0563f", "#3f7d8f", "#7a6f9c", "#4f8a63", "#b06a8a", "#c98a5e", "#5f818f", "#8a7a4a"];
function tintFor(handle: string): string {
  let n = 0;
  for (const c of handle) n = (n * 31 + c.charCodeAt(0)) | 0;
  return AV_PALETTE[Math.abs(n) % AV_PALETTE.length];
}

interface Props {
  rsvp: RsvpRecord;
  changed: boolean;
}

export function GuestRow({ rsvp, changed }: Props) {
  const { t } = useTranslation();
  return (
    <div className="guest">
      <span
        className="avatar"
        style={{ width: 24, height: 24, fontSize: 10, background: tintFor(rsvp._submitter_handle) }}
        aria-hidden="true"
      >
        {rsvp._submitter_handle.slice(0, 1).toUpperCase()}
      </span>
      <b className="who">{"@" + rsvp._submitter_handle}</b>
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
