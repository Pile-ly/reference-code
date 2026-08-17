// One event: cover hero, the details, and the RSVP card.
//
// A deep link works cold — the app host falls through to the SPA shell for
// any path it has no file for, so /event/<record id> boots here, loads the
// events table (anon-readable) and resolves the id. An id that isn't there
// gets an honest "we couldn't find that event" panel: on a public app the
// same 404 could equally mean deleted, so the page never claims to know
// which.
//
// Note what this page does NOT do: read the guest's own RSVP from the
// server. It can't — `rsvps` has an empty read group — so the "you
// answered" state comes from the per-device memo, and the copy says so.

import { Icon } from "@iconify/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "../components/CoverImage";
import { RsvpCard } from "../components/RsvpCard";
import { HOST, OWNER_HANDLE } from "../config";
import { readMemo, type RsvpMemo } from "../lib/device_memo";
import { formatWhen } from "../lib/time";
import { tintOf, useEventStore } from "../stores/event_store";
import { useSessionStore } from "../stores/session_store";

interface Props {
  eventId: string;
}

export function EventPage({ eventId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const events = useEventStore((s) => s.events);
  const loading = useEventStore((s) => s.loading);
  const loadEvents = useEventStore((s) => s.loadEvents);
  const handle = useSessionStore((s) => s.user?.handle ?? "");
  const ready = useSessionStore((s) => s.ready);

  const [memo, setMemo] = useState<RsvpMemo | null>(null);

  useEffect(() => {
    if (events === null) void loadEvents();
  }, [events, loadEvents]);

  // Memos are per (handle, event), so re-read whenever either changes —
  // including right after a sign-in resolves.
  useEffect(() => {
    setMemo(ready && handle ? readMemo(handle, eventId) : null);
  }, [ready, handle, eventId]);

  const event = events?.find((e) => e.id === eventId) ?? null;

  if (events === null || loading) {
    return (
      <div className="col">
        <p className="py-10 text-[13px]" style={{ color: "var(--faint)" }}>
          {t("home.loading")}
        </p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="col">
        <h2 className="pt-8 text-[20px] font-bold">{t("event.notFound")}</h2>
        <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted)" }}>
          {t("event.notFoundLead")}
        </p>
        <Link to="/" className="btn btn-ghost mt-5 inline-block">
          {t("event.back")}
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* The hero spans the content column, not the whole viewport — same
          600px band as the nav above it, so a wide desktop reads as one
          card rather than a full-bleed banner over a narrow column. */}
      <div className="mx-auto max-w-[600px]">
        <div className="hero relative">
          <CoverImage
            blobId={event.cover_blob_id}
            tintIndex={tintOf(event.id)}
            className="absolute inset-0 h-full w-full"
            alt=""
          />
          <button
            type="button"
            className="back-btn"
            aria-label={t("event.back")}
            onClick={() => void navigate({ to: "/" })}
          >
            <Icon icon="ph:arrow-left" width={17} />
          </button>
        </div>
      </div>

      <div className="col pt-4">
        <h2 className="text-[24px] leading-tight font-bold break-words">{event.title}</h2>

        <div className="my-3">
          <div className="meta-row">
            <span className="meta-ic" aria-hidden="true">
              <Icon icon="ph:calendar-blank" width={14} />
            </span>
            {formatWhen(event.starts_at_ms, event.tz)}
          </div>
          {event.place && (
            <div className="meta-row">
              <span className="meta-ic" aria-hidden="true">
                <Icon icon="ph:map-pin" width={14} />
              </span>
              {event.place}
            </div>
          )}
          <div className="meta-row">
            <span className="meta-ic" aria-hidden="true">
              {HOST.mark}
            </span>
            {t("event.hostedBy", { handle: OWNER_HANDLE })}
          </div>
        </div>

        {event.description && <p className="desc mt-3 mb-4">{event.description}</p>}

        <RsvpCard event={event} memo={memo} onSent={setMemo} />
      </div>
    </>
  );
}
