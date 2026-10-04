// Sample content for mock mode (`npm run dev:mock`): the club's events, so
// the home page, the event pages and the host portal have something on
// first load.
//
// `seedMock` applies once per origin and is a no-op outside mock mode; a
// production build carries none of this file's content. Rows are created
// as the mock user's, with server-minted ids and timestamps, so a seed row
// cannot reference another seed row's id — and every seeded row would
// carry the mock user's handle. RSVPs therefore start empty and are sent
// through the UI; the host portal rolls them up from there. Covers are ""
// (no photo), so every event shows its generative art: blob bytes in mock
// mode live in memory only and could not survive a reload anyway.
//
// Dates are set relative to the first load — some past, most upcoming,
// one canceled — so the page always has both sections. Computing them
// calls into lib/time.ts, which a bundler cannot prove side-effect free,
// so the seed sits behind the same build-time switch `seedMock` reads: a
// build without `VITE_PILELY_MOCK=1` drops it whole.
//
// The fakes keep every record change in this origin's localStorage across
// reloads; clear the site's data and reload to start from this seed again.

import { seedMock } from "@pilely/core";
// Registers the simple_db fake before the seed below reaches it.
import "@pilely/simple-db";
import type { EventFields } from "./lib/records";
import { wallTimeInZone, wallTimeToMs } from "./lib/time";

const TZ = "America/Los_Angeles";
const DAY_MS = 86_400_000;

/** `days` from today (negative = past), at `time` ("18:30") in the club's zone. */
function on(days: number, time: string): number {
  const date = wallTimeInZone(Date.now() + days * DAY_MS, TZ).slice(0, 10);
  return wallTimeToMs(`${date}T${time}`, TZ);
}

function event(
  days: number,
  time: string,
  fields: Pick<EventFields, "title" | "place" | "description"> & { canceled?: boolean },
): EventFields {
  return {
    starts_at_ms: on(days, time),
    tz: TZ,
    cover_blob_id: "",
    canceled: false,
    ...fields,
  };
}

function sampleEvents(): EventFields[] {
  return [
    event(-26, "18:30", {
      title: "Sunset supper in the garden",
      place: "The Linden House · Oakland",
      description:
        "One more golden-evening supper before the season turns. We’ll gather in the garden for seasonal plates, a little wine, and the kind of conversation that runs long after dessert.",
    }),
    event(-17, "13:00", {
      title: "Late-summer lakeside picnic",
      place: "Lake Merritt · Oakland",
      description:
        "A lazy lakeside afternoon with picnic blankets, iced drinks, and a shared spread. Bring your favorite something to sit on; we’ll bring the rest.",
    }),
    event(-11, "19:30", {
      title: "Rooftop jazz & natural wine",
      place: "The Kinsley Rooftop · Oakland",
      description:
        "A trio on the rooftop as the sun goes down, a table of low-intervention wines, and the whole city glittering below. Come for the music, stay for the skyline.",
    }),
    event(3, "10:00", {
      title: "Sunday cinnamon rolls & coffee",
      place: "The Annex kitchen · Oakland",
      description:
        "Warm cinnamon rolls straight from the oven, a big pot of coffee, and a slow Sunday morning with no agenda but the second cup.",
    }),
    event(8, "19:00", {
      title: "Pasta night, from scratch",
      place: "The Annex · Oakland",
      description:
        "Learn a simple hand-rolled pasta shape, then settle in for a sauce-forward dinner with the people at your station.",
    }),
    event(16, "17:00", {
      title: "Harvest long-table dinner",
      place: "Sunol Valley Farm · Sunol",
      description:
        "A long table under the string lights at the farm, plates built from the week’s harvest, and neighbors you haven’t met yet passing the bread.",
    }),
    event(23, "08:30", {
      title: "Autumn hillside hike & coffee",
      place: "Redwood Regional · Oakland",
      description:
        "A gentle climb through the redwoods to the overlook, thermoses of coffee at the top, and back down before lunch.",
      canceled: true,
    }),
  ];
}

if (import.meta.env.VITE_PILELY_MOCK === "1") {
  seedMock({ tables: { events: sampleEvents() } });
}
