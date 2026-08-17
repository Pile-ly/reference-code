// ─── The one place a copier edits ───────────────────────────────────────
//
// EVERYTHING business-specific about this storefront lives in this file:
// the owner handle, the brand, every line of marketing copy, the class
// list, and the hero-band images (static assets imported below, so Vite
// fingerprints them). Rebranding "Rock Boxing Gym" into any other
// business — a yoga studio, a bakery, a barbershop — means editing THIS
// file (plus the two deployment steps in build_instruction.md: the
// `pile_id` meta in index.html, and public/index.md — the same business
// description, but for AI agents). Nothing else in src/ mentions the gym.
//
// Marketing copy is content, so it lives here — NOT in the i18n locale
// files, which hold the app's functional strings (form labels, buttons,
// errors). A multilingual business would translate this file's strings
// per locale; the split keeps "rebrand the shop" a one-file edit.

import bandBagsUrl from "./assets/band_bags.svg";
import bandYouthUrl from "./assets/band_youth.svg";

/**
 * The storefront owner's Pilely handle — REPLACE with your own (no `@`).
 *
 * All owner-only UI (the Inquiries nav link, /admin) gates on
 * `window.pilely.user()?.handle === OWNER_HANDLE`. This is a UI
 * convenience only: simple_db enforces the real permission server-side
 * (the `inquiries` table's read group is empty, so only the owner can
 * list it), so a wrong value here can hide or show a page, never grant
 * access to the data.
 */
export const OWNER_HANDLE = "your_handle_here";

/** One offered class. `id` is what an inquiry's optional `class` column
 *  stores (stable even if the display name is reworded); `levelTone`
 *  picks the level chip's color (see globals.css `.lvl-*`). */
export interface GymClass {
  id: string;
  name: string;
  level: string;
  levelTone: "all" | "advanced" | "youth";
  schedule: string;
  coach: string;
}

export const CLASSES: GymClass[] = [
  {
    id: "beginner",
    name: "Beginner boxing",
    level: "all levels",
    levelTone: "all",
    schedule: "Mon / Wed / Fri · 6:00 pm",
    coach: "Coach Rivera",
  },
  {
    id: "conditioning",
    name: "Fight conditioning",
    level: "all levels",
    levelTone: "all",
    schedule: "Tue / Thu · 6:00 am",
    coach: "Coach Petrov",
  },
  {
    id: "sparring",
    name: "Sparring club",
    level: "advanced",
    levelTone: "advanced",
    schedule: "Tue / Thu · 7:30 pm",
    coach: "Coach Okafor",
  },
  {
    id: "youth",
    name: "Youth program",
    level: "ages 8–15",
    levelTone: "youth",
    schedule: "Sat · 10:00 am",
    coach: "Coach Lin",
  },
];

/** The display name for a class id, for the admin chip and the contact
 *  select. Falls back to the raw id — an old inquiry may reference a
 *  class this config no longer lists. */
export function classNameFor(id: string): string {
  return CLASSES.find((c) => c.id === id)?.name ?? id;
}

/** An alternating image/text band on the landing page. When the CTA has
 *  `inquireClassId`, it opens the contact form with that class
 *  pre-filled; without it, it goes to the classes page. */
export interface ContentBand {
  image: string;
  imageAlt: string;
  title: string;
  body: string;
  cta: { label: string; inquireClassId?: string };
}

export const BUSINESS = {
  /** Used for the <title>, the landing footer, and anywhere the plain
   *  name is needed. */
  name: "Rock Boxing Gym",
  /** The nav wordmark, split so the middle word takes the accent color:
   *  ROCK <accent>BOXING</accent> GYM. */
  wordmark: { lead: "ROCK", accent: "BOXING", tail: "GYM" },

  // ── Landing: hero ──
  kicker: "Est. 2011 · Oakland CA",
  /** One array entry per display line of the big headline. */
  headline: ["Train hard.", "Stay humble."],
  subhead: "Boxing for every level — first class free.",
  /** The primary CTA (hero + final band). Always routes to /contact. */
  primaryCta: "Book a free trial",

  // ── Landing: stats strip ──
  stats: [
    { value: "12", label: "Coaches" },
    { value: "450+", label: "Members" },
    { value: "15", label: "Years" },
  ],

  // ── Landing: alternating hero bands ──
  bands: [
    {
      image: bandBagsUrl,
      imageAlt: "Heavy bags hanging in the gym",
      title: "From first wraps to first fight",
      body: "Structured programs that take you from never-touched-a-glove to ring-ready. Small groups, real coaching, no ego.",
      cta: { label: "See classes" },
    },
    {
      image: bandYouthUrl,
      imageAlt: "Focus pads from the youth class",
      title: "Kids who hit pads, not walls",
      body: "Discipline, footwork, and confidence for ages 8–15. Saturday mornings, all gear provided.",
      cta: { label: "Ask about youth", inquireClassId: "youth" },
    },
  ] satisfies ContentBand[],

  // ── Landing: testimonial ──
  quote: {
    text: "“Walked in terrified, six months later I won my first amateur bout. This place changes people.”",
    by: "— Dre M., member since 2023",
  },

  // ── Landing: hours / location / contact trio ──
  info: [
    { title: "Hours", lines: ["Mon–Fri 6am–10pm", "Sat 8am–6pm · Sun closed"] },
    { title: "Location", lines: ["2140 Broadway", "Oakland, CA 94612"] },
    { title: "Contact", lines: ["Use the inquiry form —", "we answer within a day"] },
  ],

  // ── Landing: final CTA band + footer line ──
  finalHeadline: "Your corner is waiting",
  footerLine: "Rock Boxing Gym · built on Pilely",

  // ── Classes page ──
  classesLead:
    "All memberships include open gym. First class is free — inquire and we'll set you up.",

  // ── Contact page (marketing lead shown above the form/gate) ──
  contactLead:
    "First class free. Questions about memberships, classes, or private coaching — send them over.",
};
