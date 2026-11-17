import type { ComponentType } from "react";

/* One screen in the picker. `label` and `note` are the plain-words line
   above it — what the screen is, and what it is for — written for someone
   who has never seen the app.

   These are placeholder content, not chrome: write them (and everything
   inside the screen) directly in the language your user speaks. Only the
   picker's own instructions go through i18n. */
export type ScreenEntry = {
  id: string;
  label: string;
  note: string;
  Component: ComponentType;
};
