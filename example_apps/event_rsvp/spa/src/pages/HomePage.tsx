// The club's front page: who hosts, what's coming up, what already
// happened. This is the screen a SIGNED-OUT stranger sees in full —
// `events` carries `anon_read: true`, and the cover photos are blobs
// marked the same way, so nothing here needs a sign-in.
//
// Ordering: upcoming soonest-first (the next dinner is the point of the
// page), past most-recent-first. "Past" is `isPast` — start time plus a
// grace window — not a stored flag. Both are client sorts over the loaded
// rows (the service lists newest-created first); a More control loads the
// next page when there is one.

import { usePilelyAuth } from "@pilely/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EventCard } from "../components/EventCard";
import { HostHeader } from "../components/HostHeader";
import { useEvents } from "../hooks/useClubRecords";
import { readMemo } from "../lib/device_memo";
import { byLatest, bySoonest } from "../lib/records";
import { isPast } from "../lib/time";

export function HomePage() {
  const { t } = useTranslation();
  const eventsQuery = useEvents();
  const events = eventsQuery.data ?? null;
  const loadError = eventsQuery.error;
  const { ready, user } = usePilelyAuth();
  const handle = user?.handle ?? "";

  const { upcoming, past } = useMemo(() => {
    const all = events ?? [];
    return {
      upcoming: bySoonest(all.filter((e) => !isPast(e.starts_at_ms))),
      past: byLatest(all.filter((e) => isPast(e.starts_at_ms))),
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

      {events === null && eventsQuery.isPending && (
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

      {eventsQuery.hasNextPage && (
        <button
          type="button"
          className="mini-btn mt-4"
          disabled={eventsQuery.isFetchingNextPage}
          onClick={() => void eventsQuery.fetchNextPage()}
        >
          {t("home.more")}
        </button>
      )}
    </div>
  );
}
