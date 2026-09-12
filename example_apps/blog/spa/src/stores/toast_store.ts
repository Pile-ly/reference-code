// One transient toast at a time (the UX demo's pattern). Components call
// `toast(message)`; the <Toast/> component renders whatever is current.

import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (message: string) => void;
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    set({ message });
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => set({ message: null }), 2600);
  },
}));

/** Convenience for non-component call sites (store actions). */
export function toast(message: string): void {
  useToastStore.getState().show(message);
}
