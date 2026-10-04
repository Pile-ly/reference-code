// The storefront's one simple_db table, as a record type.
//
// Contract points the hooks already handle, worth knowing when reading
// this type:
//
//  1. WRITES NEST, READS ARE FLAT. A write sends the columns; the record
//     comes back with them at the TOP LEVEL, beside `id` and the
//     `_`-prefixed server-minted fields (`DbRecord`).
//  2. LISTS ARE PAGED, NEWEST FIRST — exactly the order the admin inbox
//     wants, so it pages with `hasNextPage` / `fetchNextPage` as loaded.
//  3. EVERY DENIAL IS A UNIFORM 404 — byte-identical to "no such table".
//     Never read a 404 as proof something doesn't exist; UI gates on
//     `usePilelyAuth().user`, never on a status.

import type { DbRecord } from "@pilely/simple-db";

// Columns are all `text`; see build_instruction.md.

export interface InquiryRecord extends DbRecord {
  /** The follow-up channel — a form field because the token carries the
   *  submitter's HANDLE, never their email. */
  email: string;
  question: string;
  /** Optional at the form; stored as "" when not given. */
  phone: string;
  /** Optional class id from src/config.ts (an Inquire button pre-fill);
   *  "" for a general question. */
  class: string;
}

/** What the contact form writes. Every declared column is always sent
 *  (optional ones as ""), so records stay uniform. */
export type InquiryFields = Pick<InquiryRecord, "email" | "question" | "phone" | "class">;
