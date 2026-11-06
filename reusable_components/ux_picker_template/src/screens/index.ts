/* ── YOURS TO CHANGE ────────────────────────────────────────────────────
   The screens, left to right. One entry per screen you designed; the picker
   renders the label and the device around it.

   Write the label and note in your user's language, directly — this is
   placeholder content, and it is replaced per app. Only `picker.*` in
   `src/i18n` is translated.

   To add a screen: write it next to these using only kit components, then
   list it here. Nothing else in the project needs to know about it. */
import type { ScreenEntry } from "../types";
import { AddScreen } from "./AddScreen";
import { DetailScreen } from "./DetailScreen";
import { HomeScreen } from "./HomeScreen";

export const SCREENS: ScreenEntry[] = [
  { id: "home", label: "🏠 Home", note: "all your plants at a glance", Component: HomeScreen },
  { id: "detail", label: "🪴 Plant page", note: "everything about one plant", Component: DetailScreen },
  { id: "add", label: "＋ Add a plant", note: "a quick form for new plants", Component: AddScreen },
];
