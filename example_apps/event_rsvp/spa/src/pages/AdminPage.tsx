// The host portal — where the two sides of the app meet: the events the
// host published, each with the RSVPs only the host can read.
//
// This page is the ONLY caller of loadRsvps(). For anyone else that list
// answers the uniform 404, which is the real protection; the owner check
// here just avoids showing a page that would be empty anyway. A signed-in
// non-owner who types /admin gets the same "nothing here" as a stranger.
//
// The form (new or edit) replaces the portal in place rather than routing
// somewhere — a half-filled form is not a shareable URL.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EventForm } from "../components/EventForm";
import { EventRollup } from "../components/EventRollup";
import type { EventRecord } from "../lib/db";
import { groupByEvent, rollupFor } from "../lib/rollup";
import { type EventInput, useEventStore } from "../stores/event_store";
import { useSessionStore } from "../stores/session_store";
import { toast } from "../stores/toast_store";

/** null = the portal list · "new" = the create form · a record = editing it. */
type Mode = null | "new" | EventRecord;

export function AdminPage() {
  const { t } = useTranslation();
  const ready = useSessionStore((s) => s.ready);
  const isOwner = useSessionStore((s) => s.isOwner);

  const events = useEventStore((s) => s.events);
  const rsvps = useEventStore((s) => s.rsvps);
  const loadEvents = useEventStore((s) => s.loadEvents);
  const loadRsvps = useEventStore((s) => s.loadRsvps);
  const createEvent = useEventStore((s) => s.createEvent);
  const updateEvent = useEventStore((s) => s.updateEvent);
  const setCanceled = useEventStore((s) => s.setCanceled);
  const deleteEvent = useEventStore((s) => s.deleteEvent);

  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    if (events === null) void loadEvents();
    if (rsvps === null) void loadRsvps();
  }, [isOwner, events, rsvps, loadEvents, loadRsvps]);

  // Newest event first here — the host works on what they just made,
  // unlike the public page which counts down to the next one.
  const ordered = useMemo(
    () => [...(events ?? [])].sort((a, b) => b.starts_at_ms - a.starts_at_ms),
    [events],
  );
  const byEvent = useMemo(() => groupByEvent(rsvps ?? []), [rsvps]);
  const stats = useMemo(() => {
    let heads = 0;
    let responses = 0;
    for (const e of ordered) {
      const r = rollupFor(byEvent.get(e.id) ?? []);
      heads += r.headcount;
      responses += r.latest.length;
    }
    return { events: ordered.length, heads, responses };
  }, [ordered, byEvent]);

  if (ready && !isOwner) {
    return (
      <div className="col">
        <p className="py-16 text-center text-[13.5px]" style={{ color: "var(--faint)" }}>
          {t("event.notFound")}
        </p>
      </div>
    );
  }

  async function save(input: EventInput, coverBlob: Blob | null) {
    const editing = mode instanceof Object ? (mode as EventRecord) : null;
    try {
      if (editing) {
        await updateEvent(editing, input, coverBlob);
        toast(t("form.saved"));
      } else {
        await createEvent(input, coverBlob);
        toast(t("form.published"));
      }
      setMode(null);
    } catch {
      toast(t("form.failed"));
    }
  }

  async function toggleCancel(event: EventRecord) {
    const next = !event.canceled;
    const question = next
      ? t("admin.confirmCancel", { title: event.title })
      : t("admin.confirmUncancel", { title: event.title });
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      await setCanceled(event, next);
      toast(next ? t("admin.canceledDone") : t("admin.uncanceledDone"));
    } catch {
      toast(t("admin.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: EventRecord) {
    // Name the collateral: RSVP rows other people wrote, and the cover
    // blob. All three deletes are hard — there is nothing to restore.
    const count = byEvent.get(event.id)?.length ?? 0;
    if (!window.confirm(t("admin.confirmDelete", { title: event.title, count }))) return;
    setBusy(true);
    try {
      await deleteEvent(event);
      toast(t("admin.deletedDone"));
    } catch {
      // A partial cascade leaves the event visible — pressing Delete again
      // converges (deletes tolerate "already gone").
      toast(t("admin.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (mode !== null) {
    return (
      <EventForm
        event={mode === "new" ? null : mode}
        onCancel={() => setMode(null)}
        onSave={save}
      />
    );
  }

  return (
    <div className="col view-anim">
      <div className="dash-hero">
        <p className="k">{t("admin.title")}</p>
        <h1>{t("admin.heroTitle")}</h1>
        <p>{t("admin.heroSub")}</p>
      </div>

      <div className="dash-stats">
        <div>
          <b>{stats.events}</b>
          <span>{t("admin.statEvents")}</span>
        </div>
        <div>
          <b>{stats.heads}</b>
          <span>{t("admin.statGuests")}</span>
        </div>
        <div>
          <b>{stats.responses}</b>
          <span>{t("admin.statResponses")}</span>
        </div>
      </div>

      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-bold">{t("admin.yourEvents")}</h2>
        <button type="button" className="btn btn-accent btn-sm" onClick={() => setMode("new")}>
          {"+ " + t("admin.newEvent")}
        </button>
      </div>

      {events !== null && ordered.length === 0 && (
        <p className="py-6 text-[13px]" style={{ color: "var(--faint)" }}>
          {t("admin.noEvents")}
        </p>
      )}

      {ordered.map((event) => (
        <EventRollup
          key={event.id}
          event={event}
          rows={rsvps === null ? null : (byEvent.get(event.id) ?? [])}
          rollup={rollupFor(byEvent.get(event.id) ?? [])}
          busy={busy}
          onEdit={() => setMode(event)}
          onToggleCancel={() => void toggleCancel(event)}
          onDelete={() => void remove(event)}
        />
      ))}
    </div>
  );
}
