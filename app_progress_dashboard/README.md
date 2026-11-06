# app_progress_dashboard

The progress page Pam shows a user while their app is being built: where they
are, whose turn it is, what comes next, and links to the design, the demo and
the live app. Static files only — no build, no dependencies.

It is served by the helper tools, never on its own:

```bash
node .pilely/tools/pilely.ts workspace dashboard [--lang <code>]
```

The command serves this folder on `127.0.0.1` together with three read-only
routes over the folder's saved chatroom messages (`/api/rooms`, `/api/agents`,
`/api/messages`); see `agent_tools/README.md`. The tools find this folder
beside `agent_tools/` (in the repository, or in the download at
`.pilely/reference-code/`), else at `.pilely/reference-code/app_progress_dashboard/`.

| File | What it holds |
| --- | --- |
| `index.html` | The page skeleton |
| `app.js` | Polls the routes every 2 s and draws the page |
| `progress.js` | Turns Pam's log entries into the page state (pure; tested from `agent_tools/tests/`) |
| `theme.js` | Match system / Light / Dark |
| `i18n.js`, `locales/*.json` | The 16 platform languages, English fallback, `ar` right to left |
| `icons.js` | The icons, inline, so nothing loads from the internet |
| `styles.css` | Light and dark tokens, layout, RTL |
