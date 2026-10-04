// One transient toast at a time — UI state, not data. Event handlers call
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

/** Show a toast from any event handler, outside React's render. */
export function toast(message: string): void {
  useToastStore.getState().show(message);
}
