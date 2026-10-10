# UX picker template

The page a Pilely agent shows a user to ask **"which look do you want?"** —
the same few screens shown as devices on a rail, re-skinned through four
named looks from a dock at the bottom.

It is a Vite project rather than a file to hand-edit, and that is the whole
point: **the chrome and the UI kit are code you don't touch.** Every Pilely
app's picker is the same recognizable presentation, and adapting it for an
app means writing screens, not restyling the page.

```
ux_picker_template/
├── index.html
├── src/
│   ├── App.tsx          the page: the rail, the dock, the width toggle, ?
│   ├── screens/         ← YOURS: one component per screen, plus the manifest
│   ├── i18n/            the picker's own instructions, in 16 languages
│   ├── frame/           the picker's chrome and the four looks — do not edit
│   └── kit/             the UI primitives screens are built from
└── dist/index.html      one self-contained file after `npm run build`
```

## Run it

```bash
npm install
npm run dev
```

`npm run build` emits **one self-contained `dist/index.html`** — no assets
folder, no server. That is the file you hand the user: they double-click
it, flip through the looks, and answer with a name.

## What you change

**`src/screens/`** — one component per screen, and `screens/index.ts`, the
manifest that puts them on the rail:

```ts
export const SCREENS: ScreenEntry[] = [
  { id: "home", labelKey: "screens.home.label", noteKey: "screens.home.note", Component: HomeScreen },
  // …
];
```

Write the screens' own text **directly, in your user's language** — labels,
sample rows, buttons, all of it. It is placeholder content for the user to
judge a look against, replaced per app, so it does not go through i18n and
there is nothing to translate.

Write screens using **only** the components from `src/kit`:

```tsx
import { AppHead, Chip, Cta, List, ListRow, Screen, Stats } from "../kit";

export function HomeScreen() {
  return (
    <Screen>
      <AppHead logo="🌿" title="Sprout" sub="4 plants · 2 need water" />
      <Stats items={[{ value: "4", label: "plants" }]} />
      <List>
        <ListRow flagged icon="🪴" title="Fiddle Leaf Fig" note="water today"
                 action={<Chip>Water</Chip>} />
      </List>
      <Cta>＋ Add a plant</Cta>
    </Screen>
  );
}
```

The kit carries layout and metrics only — colour, weight, border, radius
and font belong to the look. That is what makes a screen built this way
correct in all four looks without knowing they exist. `flagged` is the row
that wants attention; every look styles it, so use it rather than styling a
row yourself.

Need a shape the kit doesn't have? **Add it to the kit, and give all four
looks a rule for it** — never inline a style in a screen, or that screen
will look right in one look and wrong in the other three.

Keep the sample content believable. The user is judging a look, and empty
boxes are hard to judge.

## What you don't change

- **`src/frame/looks.css`** — the four looks. Each is a block of real
  per-element rules, not a set of variables, which is what lets Bold have
  heavy green frames and Classic hairline rules and a serif face.
- **`src/frame/frame.css`** and the frame components — the rail, the device
  shells, the labels, the floating controls, the `?` explainer. Identical
  across every Pilely app: it is what lets a user who has seen a picker
  before know what to do with this one.
- **`src/i18n/`** — the picker's own instructions: the note above the width
  toggle, the control labels, the `?` explainer. These are the same words
  for every app, and they ship in the **same 16 languages as pilely.app**
  (see `languages.ts`), Arabic included — the layout mirrors to RTL on its
  own. A user meets the picker in the language they already use the
  platform in. Force one with `?lng=ja` to check it.
- **`picker.note`** in particular — the line saying this is about style, not
  the app's page list, and inviting the user to ask for a page they want to
  see. Without it people read the screens as a spec.

`npm test` guards the contract: the look ids must match the blocks in
`looks.css`, every look must have a backdrop, every screen must render, and
all 16 locales must carry the same keys with nothing left empty.

One RTL rule comes with shipping Arabic: in `looks.css` use **logical**
edges (`border-inline-start`, `padding-inline`), never `border-left` or
`padding-right`. A physical edge puts a look's accent on the wrong side of
the card in Arabic, and nothing but looking at it would tell you — so a
test fails the build on one.

## Adapting it, end to end

1. `src/screens/` — replace the three screens with the ones you designed,
   built from kit components, with believable sample content written in your
   user's language.
2. `src/screens/index.ts` — list them left to right, each with a plain-words
   label and note.
3. `npm run build`, then hand over `dist/index.html`.

Nothing in `src/i18n/` or `src/frame/` needs touching.

The user answers with a look's **name**. They may also ask for a tweak
("Playful, but blue"), for more choices, or to see a page that isn't here —
the first two are edits to `src/frame/looks.css` for this app only, and the
third is a new screen.
