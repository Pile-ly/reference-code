// Sample content for mock mode (`npm run dev:mock`): an inbox of inquiries,
// so the owner's /admin page has something on first load. The landing,
// classes and contact pages are static content from config.ts and need no
// seed.
//
// `seedMock` applies once per origin and is a no-op outside mock mode; a
// production build carries none of this file's content. Rows are created
// as the mock user's, with server-minted ids and timestamps, so every
// seeded inquiry shows the mock user's handle and "just now".
//
// Six hand-written inquiries sit on top; behind them, older generated ones
// take the inbox past one 50-row page, so "Load more" has something to
// load. Rows are created oldest first — the server lists newest first.
// Generating rows is code a bundler cannot prove side-effect free, so the
// seed sits behind the same build-time switch `seedMock` reads: a build
// without `VITE_PILELY_MOCK=1` drops it whole.
//
// The fakes keep every record change in this origin's localStorage across
// reloads; clear the site's data and reload to start from this seed again.

import { seedMock } from "@pilely/core";
// Registers the simple_db fake before the seed below reaches it.
import "@pilely/simple-db";
import type { InquiryFields } from "./lib/records";

/** The newest inquiries, oldest first. `class` is an id from config.ts
 *  CLASSES ("" for a general question). */
const RECENT: InquiryFields[] = [
  { email: "lee@example.test", phone: "", class: "", question: "What should I bring for my very first session?" },
  { email: "jo@example.test", phone: "555-0142", class: "sparring", question: "Can I observe a sparring club session before joining?" },
  { email: "niko@example.test", phone: "", class: "conditioning", question: "Is fight conditioning appropriate after a long break from training?" },
  { email: "mara@example.test", phone: "", class: "beginner", question: "Do I need my own gloves for beginner boxing, or can I borrow a pair?" },
  { email: "theo@example.test", phone: "555-0197", class: "youth", question: "My daughter is 13 — is the youth program a good fit for a total beginner?" },
  { email: "sam@example.test", phone: "", class: "conditioning", question: "How early should I arrive for the 6 am conditioning class?" },
];

/** Older inquiries before the recent six: enough to fill more than one
 *  50-row admin page. */
const OLDER_COUNT = 54;

function sampleInquiries(): InquiryFields[] {
  const older = Array.from({ length: OLDER_COUNT }, (_, i): InquiryFields => {
    const base = RECENT[i % RECENT.length];
    const [name, domain] = base.email.split("@");
    return { ...base, email: `${name}+${i + 1}@${domain}` };
  });
  return [...older, ...RECENT];
}

if (import.meta.env.VITE_PILELY_MOCK === "1") {
  seedMock({ tables: { inquiries: sampleInquiries() } });
}
