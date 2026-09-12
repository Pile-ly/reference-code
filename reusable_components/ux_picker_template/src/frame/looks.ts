/* The looks, in dock order. `id` is the class the themed screen root wears
   and must match a block in looks.css; `name` is what the user says back
   to you ("I like Bold"). looks.test.ts fails the build if the two drift. */
export const LOOKS = [
  { id: "t-clean", name: "Clean" },
  { id: "t-bold", name: "Bold" },
  { id: "t-classic", name: "Classic" },
  { id: "t-playful", name: "Playful" },
] as const;

export type Look = (typeof LOOKS)[number];
export type LookId = Look["id"];
