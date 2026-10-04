// The host portal — where the two sides of the app meet: the events the
// host published, each with the RSVPs only the host can read.
//
// The portal is the ONLY reader of `rsvps`, and it mounts that read for
// the host alone. For anyone else that list answers the uniform 404, which
// is the real protection; the owner check here just avoids showing a page
// that would be empty anyway. A signed-in non-owner who types /admin gets
// the same "nothing here" as a stranger.
//
// The form (new or edit) replaces the portal in place rather than routing
// somewhere — a half-filled form is not a shareable URL.

import { usePilelyAuth } from "@pilely/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EventForm } from "../components/EventForm";
import { EventRollup } from "../components/EventRollup";
import { useEvents, useRsvps } from "../hooks/useClubRecords";
import { useDeleteEvent, useSaveEvent, useSetCanceled } from "../hooks/useEventWrites";
import { useIsOwner } from "../hooks/useIsOwner";
import { byLatest, type EventInput, type EventRecord } from "../lib/records";
import { groupByEvent, rollupFor } from "../lib/rollup";
import { toast } from "../stores/toast_store";

/** null = the portal list · "new" = the create form · a record = editing it. */
type Mode = null | "new" | EventRecord;

export function AdminPage() {
  const { t } = useTranslation();
  const { ready } = usePilelyAuth();
  const isOwner = useIsOwner();

  if (!ready) return null;
  if (!isOwner) {
    return (
      <div className="col">
        <p className="py-16 text-center text-[13.5px]" style={{ color: "var(--faint)" }}>
          {t("event.notFound")}
        </p>
      </div>
    );
  }
  return <HostPortal />;
}

/** Mounted for the host only, so only the host reads `rsvps`. */
function HostPortal() {
  const { t } = useTranslation();
  const eventsQuery = useEvents();
  const rsvpsQuery = useRsvps();
  const events = eventsQuery.data ?? null;
  const rsvps = rsvpsQuery.data ?? null;

  const saveEvent = useSaveEvent();
  const setCanceled = useSetCanceled();
  const deleteEvent = useDeleteEvent(rsvpsQuery);

  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);

  // Latest start first here — the host works on what is coming up and what
  // just happened, unlike the public page which counts down to the next one.
  const ordered = useMemo(() => byLatest(events ?? []), [events]);
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

  async function save(input: EventInput, coverJpeg: Blob | null) {
    const editing = mode instanceof Object ? (mode as EventRecord) : null;
    try {
      await saveEvent(editing, input, coverJpeg);
      toast(editing ? t("form.saved") : t("form.published"));
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
      // converges (record deletes tolerate "already gone").
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

      {eventsQuery.error && (
        <p role="alert" className="py-6 text-[13px]" style={{ color: "var(--muted)" }}>
          {t("home.loadFailed")}
        </p>
      )}

      {rsvpsQuery.error && (
        <p role="alert" className="pb-3 text-[13px]" style={{ color: "var(--muted)" }}>
          {t("admin.rsvpsFailed")}
        </p>
      )}

      {ordered.map((event) => (
        <EventRollup
          key={event.id}
          event={event}
          rows={rsvpsQuery.isPending ? null : (byEvent.get(event.id) ?? [])}
          rollup={rollupFor(byEvent.get(event.id) ?? [])}
          busy={busy}
          onEdit={() => setMode(event)}
          onToggleCancel={() => void toggleCancel(event)}
          onDelete={() => void remove(event)}
        />
      ))}

      {eventsQuery.hasNextPage && (
        <button
          type="button"
          className="mini-btn mt-1"
          disabled={eventsQuery.isFetchingNextPage}
          onClick={() => void eventsQuery.fetchNextPage()}
        >
          {t("home.more")}
        </button>
      )}

      {rsvpsQuery.hasNextPage && (
        <button
          type="button"
          className="mini-btn mt-1"
          disabled={rsvpsQuery.isFetchingNextPage}
          onClick={() => void rsvpsQuery.fetchNextPage()}
        >
          {t("admin.moreRsvps")}
        </button>
      )}
    </div>
  );
}
