// One event, Luma-style: a rounded cover, the title, the date/location tiles,
// the registration card, then the description.
//
// A deep link works cold — the app host falls through to the SPA shell for
// any path it has no file for, so /event/<record id> boots here, loads the
// events table (anon-readable) and resolves the id. An id that isn't there
// gets an honest "we couldn't find that event" panel: on a public app the
// same 404 could equally mean deleted, so the page never claims to know which.
//
// Note what this page does NOT do: read the guest's own RSVP from the server.
// It can't — `rsvps` has an empty read group — so the "you answered" state
// comes from the per-device memo, and the copy says so.

import { Icon } from "@iconify/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "../components/CoverImage";
import { DateBadge } from "../components/DateBadge";
import { RsvpCard } from "../components/RsvpCard";
import { HOST, OWNER_HANDLE } from "../config";
import { readMemo, type RsvpMemo } from "../lib/device_memo";
import { formatWhen } from "../lib/time";
import { useEventStore } from "../stores/event_store";
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

  const zoneLabel = event.tz.replace(/^.*\//, "").replace(/_/g, " ");

  return (
    <div className="col view-anim">
      <button type="button" className="backlink mt-1 mb-3" onClick={() => void navigate({ to: "/" })}>
        <Icon icon="ph:arrow-left" width={16} />
        {t("event.back")}
      </button>

      <div className="ev-cover">
        <CoverImage blobId={event.cover_blob_id} seed={event.id} alt="" />
        {event.canceled && <span className="cancel-flag">{t("event.canceled")}</span>}
      </div>

      <p className="ev-kicker">{t("event.invitation")}</p>
      <h1 className="ev-title">{event.title}</h1>

      <div className="mt-5 mb-1">
        <div className="meta-row">
          <DateBadge startsAtMs={event.starts_at_ms} tz={event.tz} />
          <div className="meta-text">
            <b>{formatWhen(event.starts_at_ms, event.tz)}</b>
            <small>{zoneLabel}</small>
          </div>
        </div>
        {event.place && (
          <div className="meta-row">
            <span className="pin-tile" aria-hidden="true">
              <Icon icon="ph:map-pin" width={20} />
            </span>
            <div className="meta-text">
              <b>{event.place}</b>
              <small>{t("event.venueNote")}</small>
            </div>
          </div>
        )}
        <div className="meta-row">
          <span className="avatar host" style={{ width: 52, height: 52, fontSize: 22 }} aria-hidden="true">
            {HOST.mark}
          </span>
          <div className="meta-text">
            <b>{HOST.name}</b>
            <small>{t("event.hostedBy", { handle: OWNER_HANDLE })}</small>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <RsvpCard event={event} memo={memo} onSent={setMemo} />
      </div>

      {event.description && (
        <div className="about">
          <h3>{t("event.about")}</h3>
          <p className="desc">{event.description}</p>
        </div>
      )}
    </div>
  );
}
