// The club's front page: who hosts, what's coming up, what already
// happened. This is the screen a SIGNED-OUT stranger sees in full —
// `events` carries `anon_read: true`, and the cover photos are blobs
// marked the same way, so nothing here needs a sign-in.
//
// Ordering: upcoming soonest-first (the next dinner is the point of the
// page), past most-recent-first. "Past" is `isPast` — start time plus a
// grace window — not a stored flag.

import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EventCard } from "../components/EventCard";
import { HostHeader } from "../components/HostHeader";
import { readMemo } from "../lib/device_memo";
import { isPast } from "../lib/time";
import { useEventStore } from "../stores/event_store";
import { useSessionStore } from "../stores/session_store";

export function HomePage() {
  const { t } = useTranslation();
  const events = useEventStore((s) => s.events);
  const loading = useEventStore((s) => s.loading);
  const loadError = useEventStore((s) => s.loadError);
  const loadEvents = useEventStore((s) => s.loadEvents);
  const handle = useSessionStore((s) => s.user?.handle ?? "");
  const ready = useSessionStore((s) => s.ready);

  useEffect(() => {
    if (events === null) void loadEvents();
  }, [events, loadEvents]);

  const { upcoming, past } = useMemo(() => {
    const all = events ?? [];
    return {
      upcoming: all
        .filter((e) => !isPast(e.starts_at_ms))
        .sort((a, b) => a.starts_at_ms - b.starts_at_ms),
      past: all.filter((e) => isPast(e.starts_at_ms)).sort((a, b) => b.starts_at_ms - a.starts_at_ms),
    };
  }, [events]);

  return (
    <div className="col">
      <HostHeader />

      {loadError && (
        <p className="py-6 text-[13px]" style={{ color: "var(--muted)" }}>
          {t("home.loadFailed")}
        </p>
      )}

      {events === null && loading && (
        <p className="py-6 text-[13px]" style={{ color: "var(--faint)" }}>
          {t("home.loading")}
        </p>
      )}

      {events !== null && events.length === 0 && !loadError && (
        <p className="py-6 text-[13px]" style={{ color: "var(--faint)" }}>
          {t("home.noEvents")}
        </p>
      )}

      {events !== null && events.length > 0 && (
        <>
          <div className="sechead">{t("home.upcoming")}</div>
          {upcoming.length === 0 ? (
            <p className="pb-2 text-[13px]" style={{ color: "var(--faint)" }}>
              {t("home.noUpcoming")}
            </p>
          ) : (
            upcoming.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                // The memo is this device's own record of what it sent —
                // the RSVP table itself is unreadable to a guest. Waiting
                // for `ready` keeps the chip from flashing in before we
                // know whose memos to read.
                memo={ready && handle ? readMemo(handle, e.id) : null}
              />
            ))
          )}

          {past.length > 0 && (
            <>
              <div className="sechead">{t("home.past")}</div>
              {past.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  memo={ready && handle ? readMemo(handle, e.id) : null}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
