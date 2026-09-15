// The inquiry inbox, both directions of the inbox recipe:
//
//  - `submit` — ANY signed-in visitor creates a record (`write_group:
//    null`). The store never echoes it into `rows`: the submitter cannot
//    read the table back (empty read group), so the confirmation state on
//    the contact page is all they see — the UI stays honest about that.
//  - `loadFirstPage` / `loadMore` — the OWNER's read side. `records/list`
//    answers newest-first with a cursor, so the admin page is plain
//    cursor paging: first page on mount, "Load more" appends the older
//    rows. Anyone else calling this gets the uniform 404 (simple_db
//    enforces the empty read group server-side; the /admin route gate is
//    UI convenience only).

import { create } from "zustand";
import { type InquiryRecord, SimpleDb } from "../lib/db";

/** What the contact form collects. Optional fields are stored as "" —
 *  every declared column is always sent, so records stay uniform. */
export interface InquiryInput {
  email: string;
  question: string;
  phone: string;
  /** A class id from src/config.ts, or "" for a general question. */
  class: string;
}

const PAGE_SIZE = 50;

interface InquiryState {
  /** Loaded inbox rows, newest first. Null = not loaded yet. */
  rows: InquiryRecord[] | null;
  /** Cursor for the next (older) page; null once fully loaded. */
  nextCursor: string | null;
  loading: boolean;
  error: string | null;

  loadFirstPage: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Throws on failure — the contact page owns the error toast. */
  submit: (input: InquiryInput) => Promise<void>;
}

export const useInquiryStore = create<InquiryState>((set, get) => ({
  rows: null,
  nextCursor: null,
  loading: false,
  error: null,

  loadFirstPage: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const page = await SimpleDb.listPage<InquiryRecord>("inquiries", { limit: PAGE_SIZE });
      set({ rows: page.records, nextCursor: page.next_cursor, loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadMore: async () => {
    const { loading, nextCursor, rows } = get();
    if (loading || !nextCursor) return;
    set({ loading: true, error: null });
    try {
      const page = await SimpleDb.listPage<InquiryRecord>("inquiries", {
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      set({
        rows: [...(rows ?? []), ...page.records],
        nextCursor: page.next_cursor,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  submit: async (input) => {
    await SimpleDb.create<InquiryRecord>("inquiries", {
      email: input.email,
      question: input.question,
      phone: input.phone,
      class: input.class,
    });
  },
}));
