# UX canvas

A single sheet showing every screen of the app: each page is a card with a WEB mock
(1280x800, in a browser window) and a MOBILE mock (390x800, in a phone frame). The
MOBILE / WEB toggle (keys `m` / `w`) and the LIGHT / DARK toggle (keys `l` / `d`)
sit in the top-right corner. This is a style presentation, not a working app: no
links between pages, no logic, no scripts inside the mocks.

## The three things you edit

1. `src/app.json` — `{ "name": "...", "tagline": "..." }`. The header renders from it.
2. `src/theme/tokens.css` — the design tokens. `:root` is the LIGHT theme, the
   `[data-theme="dark"]` block is the DARK one. Editing these two blocks (colours,
   font stack, radius) restyles the whole canvas; every mock uses the variables.
3. `src/pages/*` — one folder per page, auto-discovered. No registration anywhere.
   It starts empty: the canvas shows only the pages you add.

`src/shell/` and `index.html` are NEVER edited. They hold the canvas chrome, the
frames, the toggles and the component kit.

## Adding a page

Copy `src/page_template/` to `src/pages/<NN>-<slug>/`, where `<NN>` is the next
number (cards are ordered by that numeric prefix). The folder holds:

- `page.json` — `{ "title": "Home", "note": "one line about this page" }`
- `web.html` — the page markup at 1280x800 natural size
- `mobile.html` — the same page at 390x800 natural size

Both html files are required, and each holds only the page's own markup — never the
card chrome, the browser bar or the phone frame. Write real-size CSS in px; the
canvas scales each mock down to fit its card.

`src/examples/` holds two finished pages to read for how the component kit is used.
They are never shown on the canvas; do not copy them into `src/pages/`.

## Looking at one page

Click a card to open that page full screen. The toggles keep working there. `Esc`
or the button in its heading closes it; the left and right arrow keys move to the
neighbouring page.

## Component kit

Use these classes inside either html file:

- `.nav` — top bar in `web.html`, bottom tab bar in `mobile.html`
  (mobile tabs: `.tab` / `.tab.on` with a `.ico` inside)
- `.btn`, `.btn.primary`, `.input`, `.card`, `.avatar`, `.badge`, `.badge.accent`
- `.list` + `.list-item` (with `.box`, `.box.done`, `.done-text`)
- `.empty` (empty state, with a `.glyph`)
- helpers: `.row` `.col` `.grid2` `.grid3` `.spacer` `.h1` `.h2` `.muted` `.pad`

## Commands

```
npm install
npm run dev      # local canvas with hot reload
npm run build    # one self-contained dist/index.html — open or share that file
npm run preview  # serve the build
```

`dist/index.html` inlines all CSS and JS, so it opens from `file://` and can be sent
to anyone as a single file.
