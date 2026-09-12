// One transient toast at a time (the UX demo's pattern), with one UNDO
// slot. Components call `toast(message)` or `toast(message, undoFn)`; the
// <Toast/> component renders whatever is current and wires the Undo button
// to `runUndo`.
//
// The slot mechanics, straight from the UX spec: 3200 ms visibility, a new
// toast overwrites the slot (logging watering B makes watering A's undo
// unreachable — its toast is gone), and Undo hides the toast immediately.
// The undo callback closes over record ids and calls STORE actions only —
// never page-local state — so undo keeps working after a navigation (the
// toast lives in the router shell).

import { create } from "zustand";

interface ToastState {
  message: string | null;
  /** At most one undoable action — the most recent toast's, or null. */
  undo: (() => Promise<void>) | null;
  show: (message: string, undo?: () => Promise<void>) => void;
  /** Null the slot FIRST (double-tap guard), hide, then run the callback. */
  runUndo: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export const useToastStore = create<ToastState>((set, get) => ({
  message: null,
  undo: null,

  show: (message, undo) => {
    set({ message, undo: undo ?? null });
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => set({ message: null, undo: null }), 3200);
  },

  runUndo: () => {
    const { undo } = get();
    if (!undo) return;
    clearTimeout(hideTimer);
    set({ message: null, undo: null });
    // Failure surfacing is the callback's job (it toasts on error).
    void undo();
  },
}));

/** Convenience for non-component call sites. */
export function toast(message: string, undo?: () => Promise<void>): void {
  useToastStore.getState().show(message, undo);
}
