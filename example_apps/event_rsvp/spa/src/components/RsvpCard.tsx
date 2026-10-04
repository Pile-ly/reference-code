// The guest side of the app, and the one screen where the "one-way
// postcard" model is visible.
//
// Three states, chosen in this order:
//
//  1. The event is canceled or over  → a notice, no form. Nothing to answer.
//  2. `usePilelyAuth().user === null` → the sign-in gate. Gated on the
//     USER, never on a status code: this is a public app, so the runtime
//     holds an anonymous token and a denied write comes back as the
//     uniform 404, not a 401.
//  3. Signed in → the form: Going / Can't, a party stepper (going only),
//     an optional note.
//
// Sending is always a create (`useCreateRecord`) — a submitter cannot
// update their own row, so changing an answer appends a new one and the
// host portal keeps the latest (lib/rollup.ts). Afterwards the only thing
// this app can honestly tell the guest is what THIS BROWSER sent, which is
// what the memo line says, per-device caveat and all. A refused send
// renders its error under the form, which keeps the guest's input.

import { Icon } from "@iconify/react";
import { usePilelyAuth } from "@pilely/core";
import { useCreateRecord } from "@pilely/simple-db";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LIMITS } from "../config";
import type { EventRecord, RsvpRecord, RsvpStatus } from "../lib/records";
import { type RsvpMemo, writeMemo } from "../lib/device_memo";
import { isPast } from "../lib/time";
import { toast } from "../stores/toast_store";

interface Props {
  event: EventRecord;
  memo: RsvpMemo | null;
  onSent: (memo: RsvpMemo) => void;
}

export function RsvpCard({ event, memo, onSent }: Props) {
  const { t } = useTranslation();
  const { ready, user, signIn } = usePilelyAuth();
  const createRsvp = useCreateRecord<RsvpRecord>("rsvps");

  // The form opens on whatever this device last sent, so "send again to
  // change it" starts from the current answer rather than from scratch.
  const [status, setStatus] = useState<RsvpStatus>(memo?.status ?? "going");
  const [party, setParty] = useState<number>(
    memo?.status === "going" && memo.party > 0 ? memo.party : LIMITS.partyMin,
  );
  const [note, setNote] = useState("");

  if (event.canceled || isPast(event.starts_at_ms)) {
    return (
      <div className="card register">
        <p className="text-center text-[13px]" style={{ color: "var(--faint)" }}>
          {event.canceled ? t("event.canceledNotice") : t("event.pastNotice")}
        </p>
      </div>
    );
  }

  if (ready && !user) {
    return (
      <div className="card register">
        <div className="px-1 py-2 text-center">
          <p className="mb-3 text-[13px]" style={{ color: "var(--muted)" }}>
            {t("event.gateLead")}
          </p>
          <button type="button" className="btn btn-accent" onClick={() => void signIn()}>
            {t("nav.signIn")}
          </button>
        </div>
      </div>
    );
  }

  const sending = createRsvp.isPending;

  async function send() {
    if (sending || !user) return;
    // A "can't" row carries no heads — the roll-up sums party over "going"
    // rows only, and 0 keeps that sum honest either way.
    const heads = status === "going" ? party : 0;
    try {
      await createRsvp.mutateAsync({ event_id: event.id, status, party: heads, note: note.trim() });
    } catch {
      // The refusal stays in createRsvp.error and renders below the form,
      // which keeps its input for another try.
      return;
    }
    const sent: RsvpMemo = { status, party: heads, at: Date.now() };
    writeMemo(user.handle ?? "", event.id, sent);
    onSent(sent);
    setNote("");
    toast(status === "going" ? t("event.sentGoing", { count: party }) : t("event.sentCant"));
  }

  return (
    <div className="card register">
      <div className="register-top">
        <h3>{t("event.rsvpTitle")}</h3>
        <span className="secure">
          <Icon icon="ph:lock-simple" width={12} />
          {t("event.private")}
        </span>
      </div>
      <p className="mb-3.5 text-[13px]" style={{ color: "var(--muted)" }}>
        {t("event.rsvpSub")}
      </p>

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className={`statusbtn going ${status === "going" ? "on" : ""}`}
          aria-pressed={status === "going"}
          onClick={() => setStatus("going")}
        >
          {t("event.going")}
        </button>
        <button
          type="button"
          className={`statusbtn cant ${status === "cant" ? "on" : ""}`}
          aria-pressed={status === "cant"}
          onClick={() => setStatus("cant")}
        >
          {t("event.cant")}
        </button>
      </div>

      {status === "going" && (
        <div className="mb-3 flex items-center gap-2.5">
          <span className="text-[13px]" style={{ color: "var(--muted)" }}>
            {t("event.partyOf")}
          </span>
          <button
            type="button"
            className="step"
            aria-label={t("event.partyLess")}
            disabled={party <= LIMITS.partyMin}
            onClick={() => setParty((n) => Math.max(LIMITS.partyMin, n - 1))}
          >
            {"−"}
          </button>
          <span className="min-w-[18px] text-center text-[15px] font-bold">{party}</span>
          <button
            type="button"
            className="step"
            aria-label={t("event.partyMore")}
            disabled={party >= LIMITS.partyMax}
            onClick={() => setParty((n) => Math.min(LIMITS.partyMax, n + 1))}
          >
            {"+"}
          </button>
        </div>
      )}

      <input
        className="field mb-3"
        value={note}
        maxLength={LIMITS.noteMax}
        placeholder={t("event.notePlaceholder")}
        onChange={(e) => setNote(e.target.value)}
      />

      {createRsvp.error && (
        <p role="alert" className="mb-3 text-[13px]" style={{ color: "var(--cant)" }}>
          {t("event.sendRefused", { reason: createRsvp.error.message })}
        </p>
      )}

      <div className="flex justify-end">
        <button type="button" className="btn btn-accent" disabled={sending} onClick={() => void send()}>
          {sending ? t("event.sending") : t("event.send")}
        </button>
      </div>

      <div className={`memo mt-3 ${memo ? "" : "none"}`}>
        <Icon icon="ph:lock-simple" width={13} />
        <span>
          {memo
            ? memo.status === "going"
              ? t("event.memoGoing", { count: memo.party })
              : t("event.memoCant")
            : t("event.privacy")}
        </span>
      </div>
    </div>
  );
}
