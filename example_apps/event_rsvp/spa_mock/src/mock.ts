/** Deliberately local demo data. Its events mirror the deployable SPA schema. */
import type { EventFields } from "../../shared/event_contract";

export type Status = "going" | "cant";
export type Guest = "maya" | "leo" | "nina" | "omar" | "priya" | "theo" | "jade" | "marco" | "ren" | "sofia" | "host";
export interface Event extends EventFields { id: string }
export interface Rsvp { id: string; eventId: string; handle: Guest; status: Status; party: number; note: string; createdAt: number }
export interface MockState { events: Event[]; rsvps: Rsvp[]; nextId: number }

const TZ = "America/Los_Angeles";
const at = (iso: string) => Date.parse(iso);

const fixture = (): MockState => ({
  events: [
    { id: "supper", title: "Sunset supper in the garden", starts_at_ms: at("2026-09-05T18:30:00-07:00"), tz: TZ, place: "The Linden House · Oakland", description: "One more golden-evening supper before the season turns. We’ll gather in the garden for seasonal plates, a little wine, and the kind of conversation that runs long after dessert.", cover_blob_id: "", canceled: false },
    { id: "picnic", title: "Late-summer lakeside picnic", starts_at_ms: at("2026-09-14T13:00:00-07:00"), tz: TZ, place: "Lake Merritt · Oakland", description: "A lazy lakeside afternoon with picnic blankets, iced drinks, and a shared spread. Bring your favorite something to sit on; we’ll bring the rest.", cover_blob_id: "", canceled: false },
    { id: "jazz", title: "Rooftop jazz & natural wine", starts_at_ms: at("2026-09-20T19:30:00-07:00"), tz: TZ, place: "The Kinsley Rooftop · Oakland", description: "A trio on the rooftop as the sun goes down, a table of low-intervention wines, and the whole city glittering below. Come for the music, stay for the skyline.", cover_blob_id: "", canceled: false },
    { id: "rolls", title: "Sunday cinnamon rolls & coffee", starts_at_ms: at("2026-09-27T10:00:00-07:00"), tz: TZ, place: "The Annex kitchen · Oakland", description: "Warm cinnamon rolls straight from the oven, a big pot of coffee, and a slow Sunday morning with no agenda but the second cup.", cover_blob_id: "", canceled: false },
    { id: "pasta", title: "Pasta night, from scratch", starts_at_ms: at("2026-10-03T19:00:00-07:00"), tz: TZ, place: "The Annex · Oakland", description: "Learn a simple hand-rolled pasta shape, then settle in for a sauce-forward dinner with the people at your station.", cover_blob_id: "", canceled: false },
    { id: "harvest", title: "Harvest long-table dinner", starts_at_ms: at("2026-10-11T17:00:00-07:00"), tz: TZ, place: "Sunol Valley Farm · Sunol", description: "A long table under the string lights at the farm, plates built from the week’s harvest, and neighbors you haven’t met yet passing the bread.", cover_blob_id: "", canceled: false },
    { id: "hike", title: "Autumn hillside hike & coffee", starts_at_ms: at("2026-10-18T08:30:00-07:00"), tz: TZ, place: "Redwood Regional · Oakland", description: "A gentle climb through the redwoods to the overlook, thermoses of coffee at the top, and back down before lunch.", cover_blob_id: "", canceled: true },
  ],
  rsvps: [
    // supper — kept to exactly Maya + Leo (the roll-up unit test depends on it)
    { id: "r1", eventId: "supper", handle: "maya", status: "going", party: 2, note: "Bringing bread.", createdAt: 1 },
    { id: "r2", eventId: "supper", handle: "leo", status: "cant", party: 0, note: "Out of town.", createdAt: 2 },
    // picnic — note Omar's change of heart (a later row wins in the roll-up)
    { id: "r3", eventId: "picnic", handle: "leo", status: "going", party: 1, note: "Can bring a blanket!", createdAt: 3 },
    { id: "r4", eventId: "picnic", handle: "nina", status: "going", party: 2, note: "We’ll bring watermelon.", createdAt: 4 },
    { id: "r5", eventId: "picnic", handle: "omar", status: "cant", party: 0, note: "Might be traveling — will confirm.", createdAt: 5 },
    { id: "r6", eventId: "picnic", handle: "priya", status: "cant", party: 0, note: "At a wedding that weekend.", createdAt: 6 },
    { id: "r7", eventId: "picnic", handle: "theo", status: "going", party: 3, note: "Bringing the kids.", createdAt: 7 },
    { id: "r8", eventId: "picnic", handle: "omar", status: "going", party: 1, note: "Trip fell through — I’m in!", createdAt: 8 },
    // jazz
    { id: "r9", eventId: "jazz", handle: "sofia", status: "going", party: 2, note: "Love a rooftop.", createdAt: 9 },
    { id: "r10", eventId: "jazz", handle: "omar", status: "going", party: 1, note: "", createdAt: 10 },
    { id: "r11", eventId: "jazz", handle: "priya", status: "going", party: 2, note: "Bringing my sister.", createdAt: 11 },
    { id: "r12", eventId: "jazz", handle: "leo", status: "cant", party: 0, note: "Not a wine person — next time.", createdAt: 12 },
    { id: "r13", eventId: "jazz", handle: "jade", status: "going", party: 1, note: "Yes to jazz.", createdAt: 13 },
    // rolls
    { id: "r14", eventId: "rolls", handle: "maya", status: "going", party: 1, note: "I’ll come hungry.", createdAt: 14 },
    { id: "r15", eventId: "rolls", handle: "jade", status: "going", party: 2, note: "", createdAt: 15 },
    { id: "r16", eventId: "rolls", handle: "theo", status: "going", party: 1, note: "Decaf for me, please.", createdAt: 16 },
    { id: "r17", eventId: "rolls", handle: "nina", status: "cant", party: 0, note: "Not a morning person.", createdAt: 17 },
    // pasta
    { id: "r18", eventId: "pasta", handle: "jade", status: "going", party: 2, note: "Team orecchiette.", createdAt: 18 },
    { id: "r19", eventId: "pasta", handle: "marco", status: "going", party: 1, note: "Bringing a bottle of Nebbiolo.", createdAt: 19 },
    { id: "r20", eventId: "pasta", handle: "ren", status: "cant", party: 0, note: "Working late, sadly.", createdAt: 20 },
    { id: "r21", eventId: "pasta", handle: "nina", status: "going", party: 1, note: "Round two after the picnic!", createdAt: 21 },
    // harvest
    { id: "r22", eventId: "harvest", handle: "nina", status: "going", party: 2, note: "", createdAt: 22 },
    { id: "r23", eventId: "harvest", handle: "marco", status: "going", party: 4, note: "Big group from the studio.", createdAt: 23 },
    { id: "r24", eventId: "harvest", handle: "omar", status: "cant", party: 0, note: "Traveling that week.", createdAt: 24 },
    { id: "r25", eventId: "harvest", handle: "sofia", status: "going", party: 1, note: "", createdAt: 25 },
    { id: "r26", eventId: "harvest", handle: "ren", status: "going", party: 2, note: "Making up for missing pasta night.", createdAt: 26 },
    // hike (canceled) — a couple of early replies remain on file
    { id: "r27", eventId: "hike", handle: "priya", status: "going", party: 1, note: "Rain or shine!", createdAt: 27 },
    { id: "r28", eventId: "hike", handle: "theo", status: "going", party: 2, note: "", createdAt: 28 },
  ],
  nextId: 100,
});

export function resetFixtures(): MockState { return fixture(); }
export function submitRsvp(state: MockState, input: Omit<Rsvp, "id" | "createdAt">): MockState { const rsvp: Rsvp = { ...input, id: `r${state.nextId}`, createdAt: state.nextId }; return { ...state, nextId: state.nextId + 1, rsvps: [...state.rsvps, rsvp] }; }
/** Latest answer wins per guest, just like the real host portal. */
export function latestForEvent(state: MockState, eventId: string): Rsvp[] { const latest = new Map<Guest, Rsvp>(); state.rsvps.filter((r) => r.eventId === eventId).forEach((r) => { const prior = latest.get(r.handle); if (!prior || r.createdAt > prior.createdAt) latest.set(r.handle, r); }); return [...latest.values()].sort((a, b) => a.handle.localeCompare(b.handle)); }
export function rollup(state: MockState, eventId: string) { const rows = latestForEvent(state, eventId); return { going: rows.filter((r) => r.status === "going"), cant: rows.filter((r) => r.status === "cant"), heads: rows.filter((r) => r.status === "going").reduce((n, r) => n + r.party, 0) }; }
export function addEvent(state: MockState, input: Omit<Event, "id" | "cover_blob_id" | "canceled">): MockState { const id = `event-${state.nextId}`; return { ...state, nextId: state.nextId + 1, events: [...state.events, { ...input, id, cover_blob_id: "", canceled: false }] }; }
export function updateEvent(state: MockState, id: string, patch: Partial<Omit<Event, "id">>): MockState { return { ...state, events: state.events.map((event) => event.id === id ? { ...event, ...patch } : event) }; }
export function removeEvent(state: MockState, id: string): MockState { return { ...state, events: state.events.filter((event) => event.id !== id), rsvps: state.rsvps.filter((rsvp) => rsvp.eventId !== id) }; }
